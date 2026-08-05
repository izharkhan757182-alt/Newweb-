export const config = { maxDuration: 60 };

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

export default async function handler(req, res){
  cors(res);
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  try{
    const { prompt } = req.body || {};
    if(!prompt || prompt.trim().length < 3) return res.status(400).json({ error: 'Prompt required' });

    // High quality prompt banate hain
    const enhancedPrompt = `${prompt.trim()}, ultra detailed, 8k, sharp focus, highly detailed, cinematic lighting, photorealistic, masterpiece`;
    const encoded = encodeURIComponent(enhancedPrompt);
    const seed = Math.floor(Math.random() * 999999);

    // BEST QUALITY FREE MODELS - No token needed
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=1280&model=flux&seed=${seed}&enhance=true&nologo=true&nofeed=true`;

    console.log('Fetching:', imageUrl);
    const imgRes = await fetch(imageUrl);

    if(!imgRes.ok){
      throw new Error(`Pollinations failed ${imgRes.status}`);
    }

    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return res.status(200).json({
      image: base64,
      model: 'flux-8k-hd'
    });

  }catch(e){
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
