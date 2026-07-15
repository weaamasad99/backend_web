const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  
  console.error(`[API Error] Status ${statusCode}:`, err.message || err);
  if (err.stack && process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  res.status(statusCode);
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
  });
};

module.exports = { errorHandler };
