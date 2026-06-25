'use strict';

const foodOrderService = require('../services/foodOrderService');

// GET /api/orders/mine
async function listMine(req, res, next) {
  try {
    const orders = await foodOrderService.listMyOrders(req.user.sub);
    return res.json({ orders: orders.map(foodOrderService.orderPayload) });
  } catch (err) {
    return next(err);
  }
}

// GET /api/orders/business/:businessId
async function listByBusiness(req, res, next) {
  try {
    const orders = await foodOrderService.listBusinessOrders(req.params.businessId);
    return res.json({ orders: orders.map(foodOrderService.orderPayload) });
  } catch (err) {
    return next(err);
  }
}

// GET /api/orders/:id  (solo si el usuario es parte del pedido)
async function getOne(req, res, next) {
  try {
    const order = await foodOrderService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    if (order.customerId !== req.user.sub && order.courierId !== req.user.sub) {
      return res.status(403).json({ error: 'No tenes acceso a este pedido' });
    }
    return res.json({ order: foodOrderService.orderPayload(order) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listMine, listByBusiness, getOne };
