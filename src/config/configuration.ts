export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri:
    process.env.MONGO_URI ||
    'mongodb+srv://omrialt:n7hHV0YlclW8salO@aifit.afctrqu.mongodb.net/fitai?retryWrites=true&w=majority',
  jwtSecret: process.env.JWT_SECRET || 'omrialtsecretkey',
  jwtAccessSecret:
    process.env.JWT_ACCESS_SECRET || 'omrialt-access-secret-key-2025',
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET || 'omrialt-refresh-secret-key-2025',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'dcu1t68w0',
    apiKey: process.env.CLOUDINARY_API_KEY || '752815826929595',
    apiSecret:
      process.env.CLOUDINARY_API_SECRET || 'Q_XTPJPeQPjzuFlHo1ci032rTDA',
  },
  google: {
    clientId:
      process.env.GOOGLE_CLIENT_ID ||
      '347313009031-r7l6g04p68vhklaoeg4e4kot6sd625v0.apps.googleusercontent.com',
    clientSecret:
      process.env.GOOGLE_CLIENT_SECRET || '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',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback',
  },
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  email: {
    user: process.env.EMAIL_USER || 'omrialt@gmail.com',
    pass: process.env.EMAIL_PASS || 'somesecretkey',
  },
});
