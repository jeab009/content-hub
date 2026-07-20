import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CommerceCatalogService } from './commerce-catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateAffiliateLinkDto } from './dto/create-affiliate-link.dto';
import { CommerceProductResponseDto } from './dto/commerce-product-response.dto';
import { AffiliateLinkResponseDto } from './dto/affiliate-link-response.dto';

/**
 * Product catalog + affiliate links (6A.2/6A.3). Guard stack: SessionAuthGuard
 * + AdminGuard on everything, CsrfGuard on every mutation — no step-up:
 * catalog/link maintenance pushes nothing live and records no override fact
 * (the same reasoning §3.3 of the architecture doc gives for anchors).
 */
@Controller('api/commerce')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommerceCatalogController {
  constructor(private readonly catalog: CommerceCatalogService) {}

  @Post('products')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUserId() userId: string,
  ): Promise<CommerceProductResponseDto> {
    const product = await this.catalog.createProduct(dto, userId);
    return CommerceProductResponseDto.fromEntity(product);
  }

  @Get('products')
  async listProducts(@Query() query: ListProductsQueryDto): Promise<CommerceProductResponseDto[]> {
    const products = await this.catalog.listProducts(query);
    return products.map(CommerceProductResponseDto.fromEntity);
  }

  @Patch('products/:id')
  @UseGuards(CsrfGuard)
  async updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUserId() userId: string,
  ): Promise<CommerceProductResponseDto> {
    const product = await this.catalog.updateProduct(id, dto, userId);
    return CommerceProductResponseDto.fromEntity(product);
  }

  /** Soft-retire: isActive=false, retiredAt=now. Never a hard delete. */
  @Post('products/:id/retire')
  @UseGuards(CsrfGuard)
  async retireProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<CommerceProductResponseDto> {
    const product = await this.catalog.retireProduct(id, userId);
    return CommerceProductResponseDto.fromEntity(product);
  }

  @Get('products/:id/links')
  async listLinks(
    @Param('id', ParseUUIDPipe) productId: string,
  ): Promise<AffiliateLinkResponseDto[]> {
    const links = await this.catalog.listLinks(productId);
    return links.map(AffiliateLinkResponseDto.fromEntity);
  }

  @Post('products/:id/links')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async createLink(
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: CreateAffiliateLinkDto,
    @CurrentUserId() userId: string,
  ): Promise<AffiliateLinkResponseDto> {
    const link = await this.catalog.createLink(productId, dto, userId);
    return AffiliateLinkResponseDto.fromEntity(link);
  }

  /** Soft-retire a link: isActive=false, retiredAt=now. Never a hard delete. */
  @Post('links/:id/retire')
  @UseGuards(CsrfGuard)
  async retireLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<AffiliateLinkResponseDto> {
    const link = await this.catalog.retireLink(id, userId);
    return AffiliateLinkResponseDto.fromEntity(link);
  }
}
