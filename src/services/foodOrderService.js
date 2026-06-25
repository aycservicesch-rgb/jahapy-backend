'use strict';

const prisma = require('../lib/prisma');

const ORDER_STATUSES = [
  'PLACED',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'PICKED_UP',
  'DELIVERING',
  'DELIVERED',
  'CANCELLED',
];

// Transiciones que puede aplicar el COMERCIO via `order:status`.
const BUSINESS_TRANSITIONS = {
  CONFIRMED: ['PREPARING'],
  PREPARING: ['READY'],
};

// Transiciones que puede aplicar el REPARTIDOR via `order:status`.
const COURIER_TRANSITIONS = {
  PICKED_UP: ['DELIVERING'],
  DELIVERING: ['DELIVERED'],
};

// Estados "activos" (pedido en curso).
const ACTIVE_STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERING'];

const ORDER_INCLUDE = {
  customer: { select: { id: true, fullName: true, phone: true, rating: true } },
  courier: { select: { id: true, fullName: true, phone: true, rating: true } },
};

// Serializa un FoodOrder a payload publico (parsea items de JSON).
function orderPayload(order) {
  if (!order) return null;
  let items = [];
  try {
    items = JSON.parse(order.items);
  } catch (_e) {
    items = [];
  }
  return {
    id: order.id,
    status: order.status,
    businessId: order.businessId,
    items,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    address: order.address,
    notes: order.notes,
    cancelReason: order.cancelReason,
    customer: order.customer || null,
    courier: order.courier || null,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    readyAt: order.readyAt,
    deliveredAt: order.deliveredAt,
  };
}

async function createOrder(customerId, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  return prisma.foodOrder.create({
    data: {
      customerId,
      businessId: String(data.businessId),
      status: 'PLACED',
      items: JSON.stringify(items),
      subtotal: Number(data.subtotal) || 0,
      deliveryFee: Number(data.deliveryFee) || 0,
      total: Number(data.total) || 0,
      address: data.address,
      notes: data.notes || null,
    },
    include: ORDER_INCLUDE,
  });
}

// Confirmacion por parte del COMERCIO (solo si esta PLACED).
async function confirmOrder(orderId, businessId) {
  const order = await prisma.foodOrder.findUnique({ where: { id: orderId } });
  if (!order) return { error: 'Pedido no encontrado' };
  if (order.businessId !== businessId) return { error: 'No es tu comercio' };
  if (order.status !== 'PLACED') {
    return { error: `Transicion no permitida: ${order.status} -> CONFIRMED` };
  }
  const updated = await prisma.foodOrder.update({
    where: { id: orderId },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
    include: ORDER_INCLUDE,
  });
  return { order: updated };
}

// Avance de estado por el COMERCIO (PREPARING, READY).
async function advanceByBusiness(orderId, businessId, nextStatus) {
  if (!ORDER_STATUSES.includes(nextStatus)) return { error: 'Estado invalido' };
  const order = await prisma.foodOrder.findUnique({ where: { id: orderId } });
  if (!order) return { error: 'Pedido no encontrado' };
  if (order.businessId !== businessId) return { error: 'No es tu comercio' };

  const allowed = BUSINESS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    return { error: `Transicion no permitida: ${order.status} -> ${nextStatus}` };
  }

  const dataUpd = { status: nextStatus };
  if (nextStatus === 'READY') dataUpd.readyAt = new Date();

  const updated = await prisma.foodOrder.update({
    where: { id: orderId },
    data: dataUpd,
    include: ORDER_INCLUDE,
  });
  return { order: updated };
}

// Asigna el pedido a un repartidor solo si esta READY y sin courier (evita doble
// asignacion). Pasa a PICKED_UP. Devuelve el order o null si ya fue tomado.
async function acceptDelivery(orderId, courierId) {
  const result = await prisma.foodOrder.updateMany({
    where: { id: orderId, status: 'READY', courierId: null },
    data: { status: 'PICKED_UP', courierId },
  });
  if (result.count === 0) return null;
  return prisma.foodOrder.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
}

// Avance de estado por el REPARTIDOR (DELIVERING, DELIVERED).
async function advanceByCourier(orderId, courierId, nextStatus) {
  if (!ORDER_STATUSES.includes(nextStatus)) return { error: 'Estado invalido' };
  const order = await prisma.foodOrder.findUnique({ where: { id: orderId } });
  if (!order) return { error: 'Pedido no encontrado' };
  if (order.courierId !== courierId) return { error: 'No sos el repartidor de este pedido' };

  const allowed = COURIER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    return { error: `Transicion no permitida: ${order.status} -> ${nextStatus}` };
  }

  const dataUpd = { status: nextStatus };
  if (nextStatus === 'DELIVERED') dataUpd.deliveredAt = new Date();

  const updated = await prisma.foodOrder.update({
    where: { id: orderId },
    data: dataUpd,
    include: ORDER_INCLUDE,
  });
  return { order: updated };
}

// Cancelacion por el cliente (segun estado) o el comercio.
async function cancelOrder(orderId, userId, role, businessId, reason) {
  const order = await prisma.foodOrder.findUnique({ where: { id: orderId } });
  if (!order) return { error: 'Pedido no encontrado' };

  const isCustomer = order.customerId === userId;
  const isBusiness = businessId && order.businessId === businessId;
  if (!isCustomer && !isBusiness) {
    return { error: 'No sos parte de este pedido' };
  }
  if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
    return { error: 'El pedido ya finalizo' };
  }
  // El cliente solo puede cancelar antes de que el repartidor lo retire.
  if (isCustomer && !isBusiness && ['PICKED_UP', 'DELIVERING'].includes(order.status)) {
    return { error: 'No se puede cancelar: el pedido ya esta en camino' };
  }

  const updated = await prisma.foodOrder.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', cancelReason: reason || null },
    include: ORDER_INCLUDE,
  });
  return { order: updated, cancelledBy: userId };
}

async function getOrderById(orderId) {
  return prisma.foodOrder.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
}

async function listMyOrders(userId) {
  return prisma.foodOrder.findMany({
    where: { OR: [{ customerId: userId }, { courierId: userId }] },
    orderBy: { createdAt: 'desc' },
    include: ORDER_INCLUDE,
  });
}

async function listBusinessOrders(businessId) {
  return prisma.foodOrder.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    include: ORDER_INCLUDE,
  });
}

// El pedido activo de un repartidor (para reenviar su ubicacion al cliente).
async function getCourierActiveOrder(courierId) {
  return prisma.foodOrder.findFirst({
    where: { courierId, status: { in: ['PICKED_UP', 'DELIVERING'] } },
    orderBy: { createdAt: 'desc' },
    include: ORDER_INCLUDE,
  });
}

module.exports = {
  ORDER_STATUSES,
  ACTIVE_STATUSES,
  orderPayload,
  createOrder,
  confirmOrder,
  advanceByBusiness,
  acceptDelivery,
  advanceByCourier,
  cancelOrder,
  getOrderById,
  listMyOrders,
  listBusinessOrders,
  getCourierActiveOrder,
};
