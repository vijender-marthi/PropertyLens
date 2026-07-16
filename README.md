# PropertyLens

A personal real estate portfolio tracker that consolidates financial data across multiple rental properties. Upload tax returns and mortgage statements to automatically extract rent, interest, depreciation, and loan balances — then view the numbers in one place.

Architecture rule: UI renders backend-provided values only; parsing, calculations, comparisons, and field mappings live in the backend. See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Mandatory Engineering Standards

PropertyLens standards are version-controlled and mandatory for every developer, coding agent, and pull request.

- [AGENTS.md](AGENTS.md)
- [Architecture Constitution](docs/standards/ARCHITECTURE_CONSTITUTION.md)
- [UI Design Standards](docs/standards/UI_DESIGN_STANDARDS.md)
- [Domain Rules](docs/standards/DOMAIN_RULES.md)
- [AI Coding Instructions](docs/standards/AI_CODING_INSTRUCTIONS.md)
- [PR Checklist](docs/standards/PR_CHECKLIST.md)

Pull requests violating these standards should not be merged. Run:

```bash
npm run standards:check
```

---

## Features

- **Dashboard** — Portfolio-wide metrics: total value, equity, LTV, NOI, DSCR, weighted interest rate, cash flow
- **Properties** — Per-property summary with yearly P&L, performance trends, loan details, rental history, and tax data
- **Document Parsing** — Upload PDF tax returns (Schedule E) and 1098 mortgage statements; data is extracted and linked to properties automatically
- **Financing & Debt** — Loan paydown progress, interest/principal paid, annual debt service, weighted average rate
- **Risk Analysis** — Concentration risk, ARM exposure, high-rate debt, economic vacancy rate
- **Portfolio Value & Equity** — Appreciation gain, equity breakdown by property, original vs. current LTV
- **Help / Resources** — Built-in formula reference with examples for every metric

---

## Tech Stack

**Backend**
- Python 3.11, FastAPI, SQLAlchemy (SQLite)
- PDF parsing: pdfplumber, PyMuPDF, pytesseract (OCR)
- Auth: JWT via python-jose + passlib/bcrypt

**Frontend**
- React 18, React Router, Tailwind CSS
- Charts: Recharts, custom SVG
- Icons: Lucide React
- Export: jsPDF, xlsx

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Tesseract OCR (for scanned PDF parsing)
  ```bash
  # macOS
  brew install tesseract
  ```

### Run (development)

```bash
./start.sh
```

This starts both servers:
- Frontend: http://localhost:5177
- Backend API: http://localhost:8000
- API Docs (Swagger): http://localhost:8000/docs

### Run manually

```bash
# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Production build

```bash
./start.prod.sh
```

---

## Project Structure

```
PropertyLens/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── models.py                # SQLAlchemy ORM models
│   ├── database.py              # DB session and init
│   ├── requirements.txt
│   ├── routers/
│   │   ├── auth.py              # Register / login / JWT
│   │   ├── properties.py        # Properties, loans, tax entries, metrics
│   │   └── documents.py         # PDF upload and parsing
│   └── services/
│       ├── document_parser.py   # Schedule E / 1098 extraction logic
│       └── loan_calculator.py   # Amortization helpers
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── DashboardPage.jsx
│       │   ├── PropertyDetailPage.jsx
│       │   ├── HelpPage.jsx
│       │   └── ...
│       ├── components/
│       │   ├── Layout.jsx
│       │   └── ...
│       └── services/
│           └── api.js           # Axios API client
│
├── start.sh                     # Dev launcher (backend + frontend)
├── start.prod.sh                # Production launcher
└── .gitignore
```

---

## Key Metrics & Formulas

| Metric | Formula |
|--------|---------|
| Effective Rent | Monthly Rent × Occupancy Rate |
| NOI | (Effective Rent − Operating Expenses) × 12 |
| Cap Rate | Annual NOI ÷ Market Value × 100 |
| Gross Yield | (Annual Rent ÷ Market Value) × 100 |
| Cash Flow | Effective Rent − Operating Expenses − Mortgage P&I |
| DSCR | Annual NOI ÷ Annual Debt Service |
| LTV | Total Loan Balance ÷ Portfolio Value × 100 |
| Weighted Rate | Σ(Balance × Rate) ÷ Σ(Balance) |
| Annual Debt Service | Total Monthly P&I × 12 (escrow excluded) |

See the in-app **Resources → Help** page for full formulas with examples.

---

## Document Parsing Notes

- **Tax Returns (Schedule E)**: Upload as PDF. The parser reads per-property rows for rents, expenses, interest, depreciation, and net income. Addresses are matched to properties using OCR word-matching with a substring fallback for compressed text.
- **1098 Mortgage Statements**: Box 1 (interest paid) and Box 2 (outstanding principal as of Jan 1) are extracted and linked to loans by property address.
- First-year uploads auto-create tax entries; subsequent uploads for the same property/year update existing records.

---

## Notes

- The SQLite database and uploaded documents (tax returns) are excluded from this repo — they contain personal financial data.
- Single-user setup; accounts are created via `/register`.
