const AuditLog = require('../models/AuditLog');

const audit = (action) => {
  return async (req, res, next) => {
    try {
      if (req.user) {
        await AuditLog.create({
          actor: req.user._id,
          action,
          targetType: req.baseUrl || '',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') || '',
          metadata: {
            method: req.method,
            path: req.path,
            body: req.method !== 'GET' ? JSON.stringify(req.body).slice(0, 500) : '',
          },
        });
      }
    } catch (err) {
      console.error('[Audit] Failed to log:', err.message);
    }
    next();
  };
};

module.exports = audit;
