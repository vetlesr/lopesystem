# Løpesystem

Skreddersydd tidtakingssystem for ultraløp, med fokus på **Backyard Ultra**.

## Teknologistack

- **Backend**: Python / FastAPI
- **Database**: SQLite (utvikling) → PostgreSQL (produksjon)
- **Frontend**: React + Vite + TailwindCSS
- **Sanntid**: WebSockets
- **RFID**: Impinj IoT Device Interface (REST API)

## Prosjektstruktur

```
lopesystem/
├── backend/          # FastAPI backend
│   ├── main.py
│   ├── models.py
│   ├── database.py
│   ├── routers/
│   └── requirements.txt
├── frontend/         # React frontend
│   ├── src/
│   └── package.json
└── README.md
```

## Kom i gang

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

## Løpsformater

- [x] Backyard Ultra
- [ ] 10 000 meter (kommer)
- [ ] Maraton (kommer)

## RFID-integrasjon

Systemet støtter Impinj RFID-lesere via IoT Device Interface API.
For testing uten hardware, bruk den innebygde RFID-simulatoren.
