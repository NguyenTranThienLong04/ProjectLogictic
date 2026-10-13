// Metadata shapes emitted by the current Customer notification producers.
export const customerNotificationTypes = [
  ['SHIPMENT_CREATED', { trackingCode: 'SHP-CUSTOMER' }],
  ['SHIPMENT_CONFIRMED', { trackingCode: 'SHP-CUSTOMER' }],
  ['PICKUP_DRIVER_ASSIGNED', { assignmentId: '30000000-0000-4000-8000-000000000021' }],
  ['PICKUP_IN_PROGRESS', { assignmentId: '30000000-0000-4000-8000-000000000021' }],
  ['SHIPMENT_PICKED_UP', { assignmentId: '30000000-0000-4000-8000-000000000021' }],
  ['WAREHOUSE_ARRIVED', { warehouseId: '30000000-0000-4000-8000-000000000031' }],
  ['DELIVERY_DRIVER_ASSIGNED', { assignmentId: '30000000-0000-4000-8000-000000000022' }],
  ['OUT_FOR_DELIVERY', { assignmentId: '30000000-0000-4000-8000-000000000022' }],
  ['DELIVERED', { attemptId: '30000000-0000-4000-8000-000000000041' }],
  ['DELIVERY_FAILED', { attemptId: '30000000-0000-4000-8000-000000000041', reason: 'Unavailable' }],
  ['RETURN_STARTED', {}],
];
