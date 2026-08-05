// /api/generate.js — Vercel Serverless
// Fixed: Models changed to non-deprecated ones
// Primary: stabilityai/stable-diffusion-xl-base-1.0 (best quality, always active)
// Fallback: runwayml/stable-diffusion-v1-5 (fastest, always active)

export const config = { maxDuration: 60 };

const PRIMARY = "stabilityai/stable-diffusion-xl-base-1.0";
const FALLBACK = "runwayml/stable-diffusion-v1-5";

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}

function hfUrl(model){
  return `https://router.huggingface.co/hf-inference/models/${model}`;
}

async function callHF(model, prompt, token){
  const isXL = model.includes("xl");

  const resp = await fetch(hfUrl(model), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-wait-for-model': 'true',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        guidance_scale: isXL? 7.5 : 7.5,
        num_inference_steps: isXL? 25 : 30
      },
      options: { wait_for_model: true, use_cache: false }
    })
  });

  if(!resp.ok){
    const text = await resp.text();
    let errJson;
    try{ errJson = JSON.parse(text); }catch{}
    const msg = errJson?.error || text || `HF ${resp.status}`;
    const e = new Error(msg);
    e.status = resp.status;
    e.body = text;
    throw e;
  }

  const contentType = resp.headers.get('content-type') || '';
  if(contentType.includes('application/json')){
    const j = await resp.json();
    if(j.image) return { buffer: Buffer.from(j.image, 'base64'), contentType: 'image/png' };
    throw new Error('Unexpected JSON response from HF');
  }

  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: contentType || 'image/png' };
}

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.HF_TOKEN;
  if(!token) return res.status(500).json({ error: 'HF_TOKEN not set in Vercel env. Add in Dashboard → Settings → Env Variables' });

  try{
    const { prompt, ratio } = req.body || {};
    if(!prompt || typeof prompt!== 'string' || prompt.trim().length < 3){
      return res.status(400).json({ error: 'Prompt required (min 3 chars)' });
    }

    let finalPrompt = prompt.trim();
    if(ratio && ratio!== '1024x1024'){
      finalPrompt += `, ${ratio} aspect ratio, high quality, detailed`;
    }

    let result, usedModel = PRIMARY, isFallback = false;

    try{
      result = await callHF(PRIMARY, finalPrompt, token);
    }catch(err){
      console.warn('[generate] primary failed', PRIMARY, err.message, 'status', err.status);
      const shouldFallback = [429,503,500,504,410].includes(err.status) || /loading|currently|busy|rate|limit|deprecated|no longer supported/i.test(err.message);
      if(!shouldFallback) throw err;
      try{
        result = await callHF(FALLBACK, finalPrompt, token);
        usedModel = FALLBACK;
        isFallback = true;
      }catch(err2){
        console.error('[generate] fallback failed', err2.message);
        throw new Error(`Both models failed. Primary: ${err.message} | Fallback: ${err2.message}`);
      }
    }

    const base64 = result.buffer.toString('base64');
    return res.status(200).json({
      image: base64,
      model: usedModel,
      fallback: isFallback,
      contentType: result.contentType
    });

  }catch(e){
    console.error('[generate] error', e);
    return res.status(500).json({ error: e.message || 'Generation failed', details: e.body?.slice?.(0,500) });
  }
}
