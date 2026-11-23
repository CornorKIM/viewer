# Build the Vite front-end
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: static dist + api/ handlers via docker/server.mjs (Vercel stand-in)
FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Seoul PORT=3000
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY api ./api
COPY kpi.js ./kpi.js
COPY docker ./docker
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "docker/server.mjs"]
