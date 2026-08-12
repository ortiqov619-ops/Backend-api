# Xorazm Shevalari Backend API

Bu repository foydalanuvchi ilovasi va admin ilova uchun yagona backenddir.
U Fastify va PostgreSQL bilan ishlaydi; MongoDB ishlatilmaydi.

## Render’da joylash

1. Render’da **New → PostgreSQL** yarating.
2. **New → Blueprint** orqali shu GitHub repository’ni tanlang.
3. Backend uchun Render Environment oynasida quyidagilarni kiriting:

```text
DATABASE_URL=<Render PostgreSQL Internal Database URL>
ADMIN_JWT_SECRET=<uzun tasodifiy kalit>
INTEGRATION_MASTER_KEY=<boshqa uzun tasodifiy kalit>
OWNER_ADMIN_NAME=<loyiha egasi>
OWNER_ADMIN_EMAIL=<loyiha egasi emaili>
OWNER_ADMIN_PASSWORD=<kamida 12 belgili parol>
```

`render.yaml` audio yozuvlar uchun 1 GB doimiy disk va `/health` tekshiruvini
o‘zi yaratadi. Deploy tugagach Shell’da bir marta ishlating:

```bash
npm run migrate
npm run seed:admin
```

Keyin `https://<render-domen>/health` javobi `database: connected` ko‘rsatadi.
Mobil va admin ilovalarda API manzili quyidagicha bo‘ladi:

```text
https://<render-domen>/v3
```

## Lokal ishga tushirish

```bash
npm install
cp .env.example .env
# `.env` ichiga PostgreSQL manzili va maxfiy kalitlarni yozing.
npm run migrate
npm run seed:admin
npm run dev
```
