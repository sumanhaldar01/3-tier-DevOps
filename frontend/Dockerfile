# ─── STAGE 1: builder ───────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./

RUN npm install

COPY src/ ./src/

# ─── STAGE 2: production ───────────────────────────────────────
FROM node:22-alpine AS production

RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

USER node

WORKDIR /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src          ./src
COPY --from=builder --chown=node:node /app/package.json ./

EXPOSE 80

CMD ["node_modules/.bin/serve", "-s", "src", "-l", "80"]