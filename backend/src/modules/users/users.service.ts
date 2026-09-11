import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DriverAssignmentStatus,
  DriverStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { executingLineHaulTripStatuses } from '../line-haul/line-haul.constants.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordHasherService } from '../auth/password-hasher.service.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import type { CreateStaffDto } from './dto/create-staff.dto.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UserResponse } from './user.response.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User was not found',
      });
    }

    return UserResponse.fromUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponse> {
    const data: Prisma.UserUpdateInput = {};

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone?.trim() || null;
    }

    try {
      const user = await this.prisma.user.update({ where: { id: userId }, data });
      return UserResponse.fromUser(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'User was not found',
        });
      }

      throw error;
    }
  }

  async createStaff(
    actor: AuthenticatedUser,
    dto: CreateStaffDto,
    context: ClientContext,
  ): Promise<UserResponse> {
    if (dto.role === UserRole.CUSTOMER) {
      throw new ConflictException({
        code: 'USER_STAFF_ROLE_REQUIRED',
        message: 'Customer accounts must use customer registration',
      });
    }

    const passwordHash = await this.passwordHasher.hash(dto.temporaryPassword);

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            email: dto.email.trim().toLowerCase(),
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            role: dto.role,
            passwordHash,
            mustChangePassword: true,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'STAFF_ACCOUNT_CREATE',
            entityType: 'User',
            entityId: created.id,
            after: {
              email: created.email,
              role: created.role,
              status: created.status,
              mustChangePassword: created.mustChangePassword,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return created;
      });
      return UserResponse.fromUser(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
      }

      throw error;
    }
  }

  async list(query: ListUsersDto) {
    const search = query.search?.trim();
    const toDateExclusive = query.toDate
      ? new Date(new Date(`${query.toDate}T00:00:00.000Z`).getTime() + 86_400_000)
      : undefined;
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.fromDate || toDateExclusive
        ? {
            createdAt: {
              ...(query.fromDate ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: users.map((user) => UserResponse.fromUser(user)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async setStatus(
    actor: AuthenticatedUser,
    userId: string,
    status: UserStatus,
    context: ClientContext,
  ): Promise<UserResponse> {
    const user = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUnique({
        where: { id: userId },
        include: { driverProfile: true },
      });
      if (!current) {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'User was not found',
        });
      }
      if (current.id === actor.id && status === UserStatus.SUSPENDED) {
        throw new ConflictException({
          code: 'USER_SELF_SUSPENSION_FORBIDDEN',
          message: 'Administrators cannot suspend their own account',
        });
      }
      if (current.status === status) return current;

      if (status === UserStatus.SUSPENDED && current.driverProfile) {
        const activeAssignments = await transaction.driverAssignment.count({
          where: {
            driverId: current.driverProfile.id,
            status: {
              in: [DriverAssignmentStatus.PENDING, DriverAssignmentStatus.ACCEPTED],
            },
          },
        });
        if (activeAssignments > 0) {
          throw new ConflictException({
            code: 'DRIVER_HAS_ACTIVE_ASSIGNMENT',
            message: 'Reassign active shipments before suspending this driver account',
          });
        }
        const activeLineHaulTrips = await transaction.lineHaulTrip.count({
          where: {
            driverId: current.driverProfile.id,
            status: { in: executingLineHaulTripStatuses },
          },
        });
        if (activeLineHaulTrips > 0) {
          throw new ConflictException({
            code: 'DRIVER_HAS_ACTIVE_LINE_HAUL_TRIP',
            message:
              'Return the line-haul trip from READY or finish it before suspending this account',
          });
        }
      }

      const update = await transaction.user.updateMany({
        where: { id: current.id, status: current.status },
        data: { status, tokenVersion: { increment: 1 } },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'USER_CONCURRENT_MODIFICATION',
          message: 'User changed concurrently; reload and try again',
        });
      }
      if (status === UserStatus.SUSPENDED && current.driverProfile) {
        const profileUpdate = await transaction.driverProfile.updateMany({
          where: { id: current.driverProfile.id, version: current.driverProfile.version },
          data: {
            status: DriverStatus.SUSPENDED,
            isOnline: false,
            isAvailable: false,
            version: { increment: 1 },
          },
        });
        if (profileUpdate.count !== 1) {
          throw new ConflictException({
            code: 'DRIVER_CONCURRENT_MODIFICATION',
            message: 'Driver changed concurrently; reload and try again',
          });
        }
      }
      const updated = await transaction.user.findUniqueOrThrow({ where: { id: current.id } });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          actorRole: actor.role,
          action: status === UserStatus.SUSPENDED ? 'USER_SUSPEND' : 'USER_RESTORE',
          entityType: 'User',
          entityId: current.id,
          before: { status: current.status },
          after: { status: updated.status },
          metadata:
            status === UserStatus.ACTIVE && current.driverProfile
              ? { driverProfileRequiresReview: true }
              : undefined,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return updated;
    });
    return UserResponse.fromUser(user);
  }
}
