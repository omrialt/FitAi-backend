export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri:
    process.env.MONGO_URI ||
    'mongodb+srv://omrialt:n7hHV0YlclW8salO@aifit.afctrqu.mongodb.net/fitai?retryWrites=true&w=majority',
  jwtSecret: process.env.JWT_SECRET || 'omrialtsecretkey',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'dcu1t68w0',
    apiKey: process.env.CLOUDINARY_API_KEY || '752815826929595',
    apiSecret:
      process.env.CLOUDINARY_API_SECRET || 'Q_XTPJPeQPjzuFlHo1ci032rTDA',
  },
});
