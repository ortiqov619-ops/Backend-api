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
CMD ["npm", "run", "start"]
