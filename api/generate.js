export const config = { maxDuration: 60 };

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.HF_TOKEN;
  if(!token) return res.status(500).json({ error: 'HF_TOKEN missing' });

  try{
    const { prompt } = req.body || {};
    if(!prompt || prompt.trim().length < 3) return res.status(400).json({ error: 'Prompt required' });

    // HIGH QUALITY MODELS - ab ye wale kabhi deprecated nahi honge
    // Ye naye Inference Providers hai
    const providers = [
      {
        url: `https://router.huggingface.co/fal-ai/fal-ai/flux/schnell`,
        body: { prompt: prompt.trim(), image_size: "square_hd", num_inference_steps: 28, guidance_scale: 3.5, enable_safety_checker: false }
      },
      {
        url: `https://router.huggingface.co/nebius/black-forest-labs/FLUX.1-dev`,
        body: { prompt: prompt.trim() }
      }
    ];

    for(let p of providers){
      try{
        console.log(`Trying: ${p.url}`);
        const r = await fetch(p.url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(p.body)
        });

        if(r.ok){
          // fal-ai returns JSON with image url, nebius returns binary
          const ct = r.headers.get('content-type') || '';
          if(ct.includes('application/json')){
            const j = await r.json();
            // fal-ai returns { images: [{url:...}] }
            const imageUrl = j.images?.[0]?.url || j.image || j.data?.[0]?.url;
            if(imageUrl){
              const imgRes = await fetch(imageUrl);
              const buf = await imgRes.arrayBuffer();
              return res.status(200).json({ image: Buffer.from(buf).toString('base64'), model: 'flux-high-quality' });
            }
          } else {
            const buf = await r.arrayBuffer();
            return res.status(200).json({ image: Buffer.from(buf).toString('base64'), model: 'flux-high-quality' });
          }
        }
        const errText = await r.text();
        console.log(`Failed ${p.url}:`, errText.slice(0,200));
      }catch(e){
        console.log('Provider error:', e.message);
      }
    }

    throw new Error('High quality models failed - Token check karo ya thodi der baad try karo');

  }catch(e){
    return res.status(500).json({ error: e.message });
  }
}
