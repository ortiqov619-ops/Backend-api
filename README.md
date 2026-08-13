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

## Ro‘yxatda yo‘q hudud taklifi

Mobil ilova foydalanuvchisi ro‘yxatda hududini topmasa, so‘z taklifining
`payload.proposedRegion` maydonini yuboradi:

```json
{
  "nameUz": "Pitnak shahri",
  "level": "district",
  "parentRegionId": "00000000-0000-4000-8000-000000000001"
}
```

Bu qiymat xavfsizlik sababli `regions` jadvaliga avtomatik qo‘shilmaydi.
Administrator uni so‘rov moderatsiyasida ko‘radi va tasdiqlashdan oldin
`overrides.regionId` hamda, kerak bo‘lsa, `overrides.districtId` orqali mavjud
rasmiy hududga bog‘laydi. Explicit bog‘lashsiz proposal tasdiqlanmaydi.
Foydalanuvchi taklif qilgan nom manba so‘rovining audit payloadida saqlanadi,
ammo nashr qilinadigan `words` yozuviga faqat administrator tanlagan canonical
UUIDlar tushadi. Moderatsiya qarori, Word yaratish va audit bitta PostgreSQL
tranzaksiyasida bajariladi.
