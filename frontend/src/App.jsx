import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function App() {
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [variants, setVariants] = useState([]);
  const [sel, setSel] = useState({ brandId: '', modelId: '', variantId: '', date: '' });
  const [res, setRes] = useState([]);

  useEffect(() => { fetch(`${API}/api/brands`).then(r => r.json()).then(setBrands); }, []);
  
  useEffect(() => { 
    if(!sel.brandId) return; 
    fetch(`${API}/api/models/${sel.brandId}`).then(r => r.json()).then(setModels).then(() => setSel(s=>({...s, modelId:'', variantId:''}))); 
  }, [sel.brandId]);

  useEffect(() => { 
    if(!sel.modelId) return; 
    fetch(`${API}/api/variants/${sel.modelId}`).then(r => r.json()).then(setVariants).then(() => setSel(s=>({...s, variantId:''}))); 
  }, [sel.modelId]);

  const handleCalc = async () => {
    const r = await fetch(`${API}/api/calculate`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ variant_id: sel.variantId, purchase_date: sel.date })
    });
    setRes(await r.json());
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">EW Price Calculator</h1>
      <select className="w-full p-2 mb-2 border rounded" onChange={e=>setSel(s=>({...s, brandId:e.target.value}))} value={sel.brandId}>
        <option>Select Brand</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select className="w-full p-2 mb-2 border rounded" disabled={!sel.brandId} onChange={e=>setSel(s=>({...s, modelId:e.target.value}))} value={sel.modelId}>
        <option>Select Model</option>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select className="w-full p-2 mb-2 border rounded" disabled={!sel.modelId} onChange={e=>setSel(s=>({...s, variantId:e.target.value}))} value={sel.variantId}>
        <option>Select Variant</option>{variants.map(v=><option key={v.id} value={v.id}>{v.name} ({v.fuel}/{v.transmission})</option>)}
      </select>
      <input type="date" className="w-full p-2 mb-4 border rounded" onChange={e=>setSel(s=>({...s, date:e.target.value}))} value={sel.date} />
      <button className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50" onClick={handleCalc} disabled={!sel.variantId || !sel.date}>
        Calculate Price
      </button>
      
      <div className="mt-4 space-y-2">
        {res.length > 0 ? res.map((r,i)=>(
          <div key={i} className="bg-white p-3 rounded shadow flex justify-between border-l-4 border-blue-500">
            <span className="text-sm font-medium">{r.plan} ({r.dur_m}M / {r.max_kms}km)</span>
            <span className="font-bold text-lg">₹{r.price.toLocaleString('en-IN')}</span>
          </div>
        )) : <p className="text-center text-gray-400 mt-6 text-sm">No plans found for selected date/variant</p>}
      </div>
    </div>
  );
}