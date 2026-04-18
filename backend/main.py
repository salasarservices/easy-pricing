import os
from fastapi import FastAPI
from pydantic import BaseModel
from supabase import create_client, Client
from datetime import datetime
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()
app = FastAPI(title="EW Pricing API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

sb: Client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

class CalcReq(BaseModel):
    variant_id: str
    purchase_date: str  # YYYY-MM-DD

@app.get("/api/brands")
def get_brands(): return sb.table("brands").select("id, name").execute().data

@app.get("/api/models/{brand_id}")
def get_models(brand_id: str): return sb.table("models").select("id, name").eq("brand_id", brand_id).execute().data

@app.get("/api/variants/{model_id}")
def get_variants(model_id: str): return sb.table("variants").select("id, name, fuel, transmission").eq("model_id", model_id).execute().data

@app.post("/api/calculate")
def calc(req: CalcReq):
    days = (datetime.now() - datetime.strptime(req.purchase_date, "%Y-%m-%d")).days
    res = sb.table("plans").select("id, plan_name, duration_months, max_kms, tiers(*)").eq("variant_id", req.variant_id).execute().data
    
    out = []
    for p in res:
        tier = next((t for t in p["tiers"] if t["min_days"] <= days <= t["max_days"]), None)
        if tier: out.append({"plan": p["plan_name"], "dur_m": p["duration_months"], "max_kms": p["max_kms"], "price": tier["price_inr"]})
    return out