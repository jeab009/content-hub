import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AffiliateLink, CommerceProduct, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { assertSupportedCurrency } from './commerce-currency.util';
import { COMMERCE_DEFAULT_CURRENCY } from './commerce.constants';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateAffiliateLinkDto } from './dto/create-affiliate-link.dto';

/**
 * Product catalog + affiliate links (6A.2/6A.3). Soft-retire only — never a
 * hard delete, same discipline as `ContentService.archive` — so a retired
 * product/link stays reachable for every historical anchor and conversion
 * that references it.
 */
@Injectable()
export class CommerceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createProduct(dto: CreateProductDto, userId: string): Promise<CommerceProduct> {
    const currency = assertSupportedCurrency(dto.currency ?? COMMERCE_DEFAULT_CURRENCY);

    const product = await this.createProductOrConflict(
      {
        channel: dto.channel,
        externalProductId: dto.externalProductId,
        name: dto.name,
        sku: dto.sku ?? null,
        productUrl: dto.productUrl ?? null,
        listPrice: dto.listPrice !== undefined ? new Prisma.Decimal(dto.listPrice) : null,
        currency,
        commissionRatePct:
          dto.commissionRatePct !== undefined ? new Prisma.Decimal(dto.commissionRatePct) : null,
        createdBy: userId,
      },
      dto.channel,
      dto.externalProductId,
    );

    this.auditLog.record({
      actor: userId,
      action: 'commerce_product_created',
      result: 'success',
      meta: { productId: product.id, channel: product.channel },
    });

    return product;
  }

  async updateProduct(id: string, dto: UpdateProductDto, userId: string): Promise<CommerceProduct> {
    await this.findProductOrThrow(id);

    const data: Prisma.CommerceProductUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.sku !== undefined && { sku: dto.sku }),
      ...(dto.productUrl !== undefined && { productUrl: dto.productUrl }),
      ...(dto.listPrice !== undefined && { listPrice: new Prisma.Decimal(dto.listPrice) }),
      ...(dto.currency !== undefined && { currency: assertSupportedCurrency(dto.currency) }),
      ...(dto.commissionRatePct !== undefined && {
        commissionRatePct: new Prisma.Decimal(dto.commissionRatePct),
      }),
    };

    const product = await this.prisma.commerceProduct.update({ where: { id }, data });

    this.auditLog.record({
      actor: userId,
      action: 'commerce_product_updated',
      result: 'success',
      meta: { productId: id, changedFields: Object.keys(data) },
    });

    return product;
  }

  async retireProduct(id: string, userId: string): Promise<CommerceProduct> {
    await this.findProductOrThrow(id);

    const product = await this.prisma.commerceProduct.update({
      where: { id },
      data: { isActive: false, retiredAt: new Date() },
    });

    this.auditLog.record({
      actor: userId,
      action: 'commerce_product_retired',
      result: 'success',
      meta: { productId: id },
    });

    return product;
  }

  async listProducts(query: ListProductsQueryDto): Promise<CommerceProduct[]> {
    const where: Prisma.CommerceProductWhereInput = {
      ...(query.channel && { channel: query.channel }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.q && { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } }),
    };

    return this.prisma.commerceProduct.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findProductOrThrow(id: string): Promise<CommerceProduct> {
    const product = await this.prisma.commerceProduct.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Commerce product not found');
    }
    return product;
  }

  async createLink(
    productId: string,
    dto: CreateAffiliateLinkDto,
    userId: string,
  ): Promise<AffiliateLink> {
    await this.findProductOrThrow(productId);

    const link = await this.createLinkOrConflict(
      {
        productId,
        url: dto.url,
        trackingCode: dto.trackingCode ?? null,
        subId: dto.subId ?? null,
        createdBy: userId,
      },
      productId,
    );

    this.auditLog.record({
      actor: userId,
      action: 'affiliate_link_created',
      result: 'success',
      // url/trackingCode are excluded from meta (System Analyst SA-4 exclusion list).
      meta: { linkId: link.id, productId },
    });

    return link;
  }

  async retireLink(id: string, userId: string): Promise<AffiliateLink> {
    const existing = await this.prisma.affiliateLink.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Affiliate link not found');
    }

    const link = await this.prisma.affiliateLink.update({
      where: { id },
      data: { isActive: false, retiredAt: new Date() },
    });

    this.auditLog.record({
      actor: userId,
      action: 'affiliate_link_retired',
      result: 'success',
      meta: { linkId: id, productId: link.productId },
    });

    return link;
  }

  async listLinks(productId: string): Promise<AffiliateLink[]> {
    await this.findProductOrThrow(productId);
    return this.prisma.affiliateLink.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Translates the UNIQUE(channel, externalProductId) violation into a 409. */
  private async createProductOrConflict(
    data: Prisma.CommerceProductUncheckedCreateInput,
    channel: string,
    externalProductId: string,
  ): Promise<CommerceProduct> {
    try {
      return await this.prisma.commerceProduct.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `A ${channel} product with external id "${externalProductId}" already exists.`,
        );
      }
      throw error;
    }
  }

  /** Translates the UNIQUE(productId, url) violation into a 409. */
  private async createLinkOrConflict(
    data: Prisma.AffiliateLinkUncheckedCreateInput,
    productId: string,
  ): Promise<AffiliateLink> {
    try {
      return await this.prisma.affiliateLink.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `This URL is already registered as a link on product ${productId}.`,
        );
      }
      throw error;
    }
  }
}
