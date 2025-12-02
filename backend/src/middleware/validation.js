const Joi = require('joi');

const logSchema = Joi.object({
  service: Joi.string().required(),
  level: Joi.string().valid('INFO', 'WARN', 'ERROR', 'DEBUG').required(),
  message: Joi.string().required(),
  latency_ms: Joi.number().optional(),
  userId: Joi.number().optional()
});

const validateLog = (req, res, next) => {
  const { error } = logSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  
  next();
};

module.exports = { validateLog };
