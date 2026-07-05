web: node backend/dist/server.js
postdeploy: npm --prefix backend run prisma:deploy && npm --prefix backend run seed:deploy
