const Razorpay = require('razorpay');
const crypto = require('crypto');
const logger = require('../utils/logger');

let razorpayInstance = null;

const initializeRazorpay = () => {
  try {
    if (!razorpayInstance) {
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials are not configured');
      }

      razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      logger.info('Razorpay initialized successfully');
    }
    
    return razorpayInstance;
  } catch (error) {
    logger.error('Failed to initialize Razorpay:', error);
    throw error;
  }
};

const getRazorpayInstance = () => {
  if (!razorpayInstance) {
    return initializeRazorpay();
  }
  return razorpayInstance;
};

const createOrder = async (orderData) => {
  try {
    const instance = getRazorpayInstance();
    const order = await instance.orders.create(orderData);
    
    logger.info('Razorpay order created successfully', {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
    
    return order;
  } catch (error) {
    logger.error('Failed to create Razorpay order:', error);
    throw error;
  }
};

const verifyPaymentSignature = (orderData) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = orderData;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error('Missing required payment verification parameters');
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isSignatureValid = expectedSignature === razorpay_signature;
    
    logger.info('Payment signature verification', {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      isValid: isSignatureValid,
    });

    return isSignatureValid;
  } catch (error) {
    logger.error('Payment signature verification failed:', error);
    throw error;
  }
};

const fetchPayment = async (paymentId) => {
  try {
    const instance = getRazorpayInstance();
    const payment = await instance.payments.fetch(paymentId);
    
    logger.debug('Payment details fetched', {
      paymentId,
      status: payment.status,
      amount: payment.amount,
    });
    
    return payment;
  } catch (error) {
    logger.error('Failed to fetch payment details:', error);
    throw error;
  }
};

const fetchOrder = async (orderId) => {
  try {
    const instance = getRazorpayInstance();
    const order = await instance.orders.fetch(orderId);
    
    logger.debug('Order details fetched', {
      orderId,
      status: order.status,
      amount: order.amount,
    });
    
    return order;
  } catch (error) {
    logger.error('Failed to fetch order details:', error);
    throw error;
  }
};

const fetchOrderPayments = async (orderId) => {
  try {
    const instance = getRazorpayInstance();
    const payments = await instance.orders.fetchPayments(orderId);
    
    logger.debug('Order payments fetched', {
      orderId,
      paymentCount: payments.count,
    });
    
    return payments;
  } catch (error) {
    logger.error('Failed to fetch order payments:', error);
    throw error;
  }
};

const createRefund = async (paymentId, refundData) => {
  try {
    const instance = getRazorpayInstance();
    const refund = await instance.payments.refund(paymentId, refundData);
    
    logger.info('Refund created successfully', {
      refundId: refund.id,
      paymentId,
      amount: refund.amount,
    });
    
    return refund;
  } catch (error) {
    logger.error('Failed to create refund:', error);
    throw error;
  }
};

const fetchRefund = async (paymentId, refundId) => {
  try {
    const instance = getRazorpayInstance();
    const refund = await instance.payments.fetchRefund(paymentId, refundId);
    
    logger.debug('Refund details fetched', {
      refundId,
      paymentId,
      status: refund.status,
    });
    
    return refund;
  } catch (error) {
    logger.error('Failed to fetch refund details:', error);
    throw error;
  }
};

const verifyWebhookSignature = (webhookBody, webhookSignature) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error('Webhook secret not configured');
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    const isSignatureValid = expectedSignature === webhookSignature;
    
    logger.info('Webhook signature verification', {
      isValid: isSignatureValid,
    });

    return isSignatureValid;
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    throw error;
  }
};

module.exports = {
  initializeRazorpay,
  getRazorpayInstance,
  createOrder,
  verifyPaymentSignature,
  fetchPayment,
  fetchOrder,
  fetchOrderPayments,
  createRefund,
  fetchRefund,
  verifyWebhookSignature,
};
