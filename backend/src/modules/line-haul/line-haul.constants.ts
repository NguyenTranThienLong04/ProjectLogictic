import { LineHaulTripStatus } from '../../generated/prisma/client.js';

export const activeLineHaulTripStatuses: LineHaulTripStatus[] = [
  LineHaulTripStatus.PLANNED,
  LineHaulTripStatus.READY,
  LineHaulTripStatus.IN_TRANSIT,
];

export const executingLineHaulTripStatuses: LineHaulTripStatus[] = [
  LineHaulTripStatus.READY,
  LineHaulTripStatus.IN_TRANSIT,
];

export const configurableLineHaulTripStatuses: LineHaulTripStatus[] = [LineHaulTripStatus.PLANNED];

export const cancellableLineHaulTripStatuses: LineHaulTripStatus[] = [
  LineHaulTripStatus.PLANNED,
  LineHaulTripStatus.READY,
];
