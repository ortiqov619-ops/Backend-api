FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
RUN npm ci --ignore-scripts

COPY shared shared
COPY src src
COPY db/migrations db/migrations

ENV NODE_ENV=production
EXPOSE 3000
# Migrations and the owner-admin account setup are idempotent. Running them
# before the API starts keeps a fresh Render Postgres database deployable
# without a paid interactive shell.
CMD ["/bin/sh", "-c", "npm run migrate && npm run seed:admin && npm run start"]
