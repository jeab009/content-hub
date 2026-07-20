import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CommerceProduct, Prisma, ProductAnchor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { AnchorItemDto, RecordProductAnchorsDto } from './dto/record-product-anchors.dto';

/** Which side of the XOR target this request is anchoring to. */
type AnchorTarget = { postId: string } | { placementId: string };

/**
 * Product anchors (6A.4) — "this product was pinned on this post/placement."
 * No step-up (System Analyst SA-3, confirmed): anchoring records no override
 * fact and pushes nothing live, so CSRF + AdminGuard + audit is the correct
 * stack, and requiring a password here would train reflexive password entry
 * that measurably weakens step-up where it matters.
 *
 * Anchoring is IDEMPOTENT per (target, product): re-submitting a product
 * that is already actively anchored returns the existing row rather than
 * erroring or creating a duplicate — the partial unique index
 * (`WHERE removed_at IS NULL`) is the race-proof backstop either way.
 * Un-anchoring soft-removes (`removedAt`), never deletes, so an
 * un-anchor → re-anchor cycle keeps its history.
 */
@Injectable()
export class CommerceAnchorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async anchorToPost(
    postId: string,
    dto: RecordProductAnchorsDto,
    userId: string,
  ): Promise<ProductAnchor[]> {
    await this.assertPostExists(postId);
    return this.anchorAll({ postId }, dto, userId);
  }

  async anchorToPlacement(
    placementId: string,
    dto: RecordProductAnchorsDto,
    userId: string,
  ): Promise<ProductAnchor[]> {
    await this.assertPlacementExists(placementId);
    return this.anchorAll({ placementId }, dto, userId);
  }

  async listForPost(postId: string): Promise<ProductAnchor[]> {
    await this.assertPostExists(postId);
    return this.list({ postId, removedAt: null });
  }

  async listForPlacement(placementId: string): Promise<ProductAnchor[]> {
    await this.assertPlacementExists(placementId);
    return this.list({ placementId, removedAt: null });
  }

  async removeFromPost(postId: string, anchorId: string, userId: string): Promise<void> {
    await this.removeOne({ postId }, anchorId, userId);
  }

  async removeFromPlacement(placementId: string, anchorId: string, userId: string): Promise<void> {
    await this.removeOne({ placementId }, anchorId, userId);
  }

  private async anchorAll(
    target: AnchorTarget,
    dto: RecordProductAnchorsDto,
    userId: string,
  ): Promise<ProductAnchor[]> {
    const results: ProductAnchor[] = [];
    for (const item of dto.anchors) {
      results.push(await this.anchorOne(target, item, userId));
    }

    this.auditLog.record({
      actor: userId,
      action: 'product_anchor_recorded',
      result: 'success',
      meta: { ...target, productIds: dto.anchors.map((item) => item.productId) },
    });

    return results;
  }

  private async anchorOne(
    target: AnchorTarget,
    item: AnchorItemDto,
    userId: string,
  ): Promise<ProductAnchor> {
    const existing = await this.prisma.productAnchor.findFirst({
      where: { ...target, productId: item.productId, removedAt: null },
    });
    if (existing) {
      return existing;
    }

    await this.assertProductIsActive(item.productId);
    if (item.affiliateLinkId) {
      await this.assertLinkBelongsToProduct(item.affiliateLinkId, item.productId);
    }

    return this.createAnchorOrConflict({
      ...target,
      productId: item.productId,
      affiliateLinkId: item.affiliateLinkId ?? null,
      recordedBy: userId,
    });
  }

  private async removeOne(target: AnchorTarget, anchorId: string, userId: string): Promise<void> {
    const anchor = await this.prisma.productAnchor.findFirst({
      where: { id: anchorId, ...target, removedAt: null },
    });
    if (!anchor) {
      throw new NotFoundException('Product anchor not found (or already removed)');
    }

    await this.prisma.productAnchor.update({
      where: { id: anchorId },
      data: { removedAt: new Date() },
    });

    this.auditLog.record({
      actor: userId,
      action: 'product_anchor_removed',
      result: 'success',
      meta: { ...target, anchorId, productId: anchor.productId },
    });
  }

  private list(where: Prisma.ProductAnchorWhereInput): Promise<ProductAnchor[]> {
    // Ties break by anchoredAt (Phase 6.0 decision — anchorPosition is
    // deliberately NOT unique per target; see COMMERCE_ANCHOR_ORDER_TIE_BREAK).
    return this.prisma.productAnchor.findMany({
      where,
      orderBy: [{ anchorPosition: 'asc' }, { anchoredAt: 'asc' }],
    });
  }

  private async assertPostExists(postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
  }

  private async assertPlacementExists(placementId: string): Promise<void> {
    const placement = await this.prisma.commercePlacement.findUnique({
      where: { id: placementId },
      select: { id: true },
    });
    if (!placement) {
      throw new NotFoundException('Commerce placement not found');
    }
  }

  private async assertProductIsActive(productId: string): Promise<CommerceProduct> {
    const product = await this.prisma.commerceProduct.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Commerce product not found');
    }
    if (!product.isActive) {
      throw new ConflictException(`Product ${productId} is retired and can no longer be anchored`);
    }
    return product;
  }

  /**
   * A clean 400-shaped rejection for "this link belongs to a different
   * product", ahead of the composite FK
   * `(affiliate_link_id, product_id) REFERENCES affiliate_links(id, product_id)`,
   * which would otherwise surface as an opaque FK-violation 500.
   */
  private async assertLinkBelongsToProduct(linkId: string, productId: string): Promise<void> {
    const link = await this.prisma.affiliateLink.findUnique({ where: { id: linkId } });
    if (!link) {
      throw new NotFoundException('Affiliate link not found');
    }
    if (link.productId !== productId) {
      throw new ConflictException(
        `Affiliate link ${linkId} belongs to a different product than ${productId}`,
      );
    }
  }

  private async createAnchorOrConflict(
    data: Prisma.ProductAnchorUncheckedCreateInput,
  ): Promise<ProductAnchor> {
    try {
      return await this.prisma.productAnchor.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A truly-concurrent duplicate anchor slipped past the app-level
        // idempotency check's TOCTOU window — the partial unique index is
        // the race-proof backstop, same pattern as createPostOrConflict.
        throw new ConflictException('This product is already anchored (created concurrently)');
      }
      throw error;
    }
  }
}
