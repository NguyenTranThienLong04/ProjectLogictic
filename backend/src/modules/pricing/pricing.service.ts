import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserRole, type PricingConfig } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreatePricingConfigDto } from './dto/create-pricing-config.dto.js';
import type { ShippingQuoteDto } from './dto/shipping-quote.dto.js';
import type { PricingBreakdown, PublicPricingConfig } from './pricing.types.js';
import { PricingConfigUnavailableException } from './pricing-config-unavailable.exception.js';

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(dto: ShippingQuoteDto): Promise<PricingBreakdown> {
    const config = await this.getActiveConfigEntity();
    return this.calculate(dto.weightGrams, dto.codAmount, config);
  }

  calculate(weightGrams: number, codAmount: number, config: PricingConfig): PricingBreakdown {
    const excessGrams = Math.max(0, weightGrams - config.includedWeightGrams);
    const excessKg = Math.ceil(excessGrams / 1_000);
    const weightFee = excessKg * config.extraWeightFeePerKg;
    const codFee = Math.ceil((codAmount * config.codFeeBasisPoints) / 10_000);
    const totalFee =
      config.baseFee + weightFee + codFee + config.distanceFee + config.surcharge - config.discount;

    return {
      configVersion: config.version,
      baseFee: config.baseFee,
      distanceFee: config.distanceFee,
      weightFee,
      codFee,
      surcharge: config.surcharge,
      discount: config.discount,
      totalFee,
    };
  }

  async getActiveConfig(): Promise<PublicPricingConfig> {
    return this.toPublicConfig(await this.getActiveConfigEntity());
  }

  async getActiveConfigEntity(client?: Prisma.TransactionClient): Promise<PricingConfig> {
    const pricingClient = client ?? this.prisma;
    const config = await pricingClient.pricingConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!config) {
      throw new PricingConfigUnavailableException();
    }
    return config;
  }

  async createConfig(actorId: string, dto: CreatePricingConfigDto): Promise<PublicPricingConfig> {
    try {
      const config = await this.prisma.$transaction(
        async (transaction) => {
          const latest = await transaction.pricingConfig.findFirst({
            orderBy: { version: 'desc' },
          });
          await transaction.pricingConfig.updateMany({
            where: { isActive: true },
            data: { isActive: false },
          });
          const created = await transaction.pricingConfig.create({
            data: {
              version: (latest?.version ?? 0) + 1,
              baseFee: dto.baseFee,
              includedWeightGrams: dto.includedWeightGrams,
              extraWeightFeePerKg: dto.extraWeightFeePerKg,
              codFeeBasisPoints: dto.codFeeBasisPoints,
              distanceFee: 0,
              surcharge: 0,
              discount: 0,
              createdById: actorId,
            },
          });
          await transaction.auditLog.create({
            data: {
              actorId,
              actorRole: UserRole.ADMIN,
              action: 'PRICING_CONFIG_ACTIVATE',
              entityType: 'PricingConfig',
              entityId: created.id,
              ...(latest
                ? {
                    before: {
                      version: latest.version,
                      baseFee: latest.baseFee,
                      includedWeightGrams: latest.includedWeightGrams,
                      extraWeightFeePerKg: latest.extraWeightFeePerKg,
                      codFeeBasisPoints: latest.codFeeBasisPoints,
                    },
                  }
                : {}),
              after: {
                version: created.version,
                baseFee: created.baseFee,
                includedWeightGrams: created.includedWeightGrams,
                extraWeightFeePerKg: created.extraWeightFeePerKg,
                codFeeBasisPoints: created.codFeeBasisPoints,
              },
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.toPublicConfig(config);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException({
          code: 'PRICING_CONFIG_CONFLICT',
          message: 'Pricing changed concurrently; reload and try again',
        });
      }
      throw error;
    }
  }

  private toPublicConfig(config: PricingConfig): PublicPricingConfig {
    return {
      id: config.id,
      version: config.version,
      baseFee: config.baseFee,
      includedWeightGrams: config.includedWeightGrams,
      extraWeightFeePerKg: config.extraWeightFeePerKg,
      codFeeBasisPoints: config.codFeeBasisPoints,
      distanceFee: config.distanceFee,
      surcharge: config.surcharge,
      discount: config.discount,
      isActive: config.isActive,
      createdAt: config.createdAt,
    };
  }
}
