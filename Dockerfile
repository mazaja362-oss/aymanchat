# syntax=docker/dockerfile:1
FROM node:22-alpine AS client-build
WORKDIR /build
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client-build /build/client/dist ./client-dist
ENV PORT=3000
ENV CLIENT_ORIGIN=http://localhost:3000
ENV CLIENT_DIST=/app/client-dist
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/index.js"]
