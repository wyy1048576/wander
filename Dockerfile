# Wander on a single always-on container (Railway, Render, Fly, any Docker host).
# SQLite lives at $DB_PATH; mount a volume at /data so rooms survive restarts.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DB_PATH=/data/app.db PORT=3000
RUN mkdir -p /data
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/src/data ./src/data
EXPOSE 3000
CMD ["npm", "start"]
