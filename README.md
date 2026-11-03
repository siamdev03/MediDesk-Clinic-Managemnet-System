# 🏥 MediDesk – Clinic Management System

MERN stack: **MongoDB + Express + React (Vite) + Node.js**. 110 features across 52 modules – see [FEATURES.md](FEATURES.md).

## What you need
- **Node.js 18 or newer** (https://nodejs.org)
- **MongoDB** running locally on the default port, or a free MongoDB Atlas cluster
  - Windows/macOS/Linux installer: https://www.mongodb.com/try/download/community
  - or with Docker: `docker run -d --name mongo -p 27017:27017 mongo:7`

## Run on localhost (3 steps)
```bash
cd medidesk
npm run setup        # installs root, server and client packages
npm run seed         # demo doctors, patients, medicines, invoices … (optional)
npm run dev          # API on :5000, web app on :5173
```
Open **http://localhost:5173**

If you skip the seed, the first screen lets you create your own administrator account.

### Demo logins (after `npm run seed`)
| Role | Email | Password |
|---|---|---|
| Admin | admin@medidesk.com | Admin@123 |
| Doctor | doctor@medidesk.com | Pass@123 |
| Receptionist | reception@medidesk.com | Pass@123 |
| Nurse / Pharmacist / Lab / Accountant | nurse@ · pharmacy@ · lab@ · accounts@medidesk.com | Pass@123 |

`npm run seed:fresh` wipes the database and re-creates the demo data.

## Configuration
`server/.env` (already created with local defaults):
```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/medidesk     # or your Atlas connection string
JWT_SECRET=change-me
TIMEZONE=Asia/Dhaka
CLIENT_ORIGIN=http://localhost:5173
```
Change `JWT_SECRET` before putting this anywhere other than your own computer.

## Single-port production mode
```bash
npm run start        # builds the React app, then serves everything from http://localhost:5000
```

## Project layout
```
medidesk/
├─ server/src
│  ├─ config/modules.js   every module's fields & permissions (add a module here)
│  ├─ config/logic.js     business rules: hooks and workflow actions
│  ├─ config/engine.js    generic CRUD, validation, audit, CSV import/export
│  ├─ routes/             auth, generic CRUD API (/api/m/:module), dashboard, reports, search …
│  └─ seed.js             demo data
└─ client/src
   ├─ pages/              Dashboard, ModulePage (generic list/form), PatientProfile, Calendar, Queue, Bed map, Reports, Print …
   └─ components/         forms, tables, charts, dialogs
```
Adding a new module = add one entry to `server/src/config/modules.js`; the menu, list, form, filters, CSV and print view appear automatically.

## Troubleshooting
- **"Could not connect to MongoDB"** – start MongoDB, or fix `MONGO_URI` in `server/.env`.
- **Port already in use** – change `PORT` in `server/.env` (and the proxy target in `client/vite.config.js`).
- **Windows PowerShell blocks npm scripts** – run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt.
