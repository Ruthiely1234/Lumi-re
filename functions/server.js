console.log("DEBUG: Lançando versão Lumière 2.0 (Relocação IA)...");
require('dotenv').config();
const express = require('express');
const serverless = require('serverless-http');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3001;

// Validação das chaves do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERRO: Variáveis SUPABASE_URL e SUPABASE_KEY não configuradas no arquivo .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());

// Middleware de Autenticação para Rotas de Administração
const adminAuth = (req, res, next) => {
    const pass = req.headers['x-admin-password'];
    // A senha definida conforme requisitos
    if (pass === 'Ruthiely2012') {
        next();
    } else {
        res.status(401).json({ error: 'Não autorizado. Senha incorreta.' });
    }
};

// =======================
// ROTAS DA API (CRUD e Vendas)
// =======================

// 1. READ: Listar todos os produtos (Público)
app.get('/api/products', async (req, res) => {
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 2. VENDA: Endpoint de venda que reduz o estoque do produto (Público, pois é da loja)
app.post('/api/products/:id/sell', async (req, res) => {
    const productId = req.params.id;
    const qty = 1;

    const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('stock')
        .eq('id', productId)
        .single();
    
    if (fetchError || !product) {
        return res.status(404).json({ error: 'Produto não encontrado' });
    }

    if (product.stock < qty) {
        return res.status(400).json({ error: 'Estoque insuficiente' });
    }

    const { data, error: updateError } = await supabase
        .from('products')
        .update({ stock: product.stock - qty })
        .eq('id', productId)
        .select()
        .single();

    if (updateError) return res.status(500).json({ error: updateError.message });
    res.json({ message: 'Venda realizada com sucesso!', product: data });
});

// 3. CREATE: Criar novo produto (Admin)
app.post('/api/products', adminAuth, async (req, res) => {
    const { name, description, price, stock, image_url } = req.body;
    
    const { data, error } = await supabase
        .from('products')
        .insert([{ name, description, price, stock, image_url }])
        .select()
        .single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

// 4. UPDATE: Atualizar produto (Admin)
app.put('/api/products/:id', adminAuth, async (req, res) => {
    const { name, description, price, stock, image_url } = req.body;
    
    const { data, error } = await supabase
        .from('products')
        .update({ name, description, price, stock, image_url })
        .eq('id', req.params.id)
        .select()
        .single();
        
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 5. DELETE: Excluir produto (Admin)
app.delete('/api/products/:id', adminAuth, async (req, res) => {
    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', req.params.id);
        
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Produto excluído com sucesso.' });
});

// 6. UPLOAD: Upload de Imagem para Supabase Storage (Admin)
app.post('/api/upload', adminAuth, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        const file = req.file;
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;
        const filePath = `products/${fileName}`;

        // Garantir que o bucket existe (Supabase lançará erro se já existir, capturamos silenciosamente)
        await supabase.storage.createBucket('product-images', { public: true }).then(() => {
            console.log('Bucket "product-images" criado com sucesso.');
        }).catch(err => {
            // Ignora erro de bucket já existente
        });

        const { data, error } = await supabase.storage
            .from('product-images')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (error) throw error;

        // Gerar URL Pública
        const { data: { publicUrl } } = supabase.storage
            .from('product-images')
            .getPublicUrl(filePath);

        res.json({ url: publicUrl });

    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7. IA MARKETING: Sugestões de promoção e posts (Admin)
app.post('/admin/ia-marketing', adminAuth, async (req, res) => {
    const { tone } = req.body;
    
    try {
        // 1. Buscar produtos do Supabase
        const { data: products, error } = await supabase
            .from('products')
            .select('*')
            .order('name');
        
        if (error) throw new Error(error.message);

        // 2. Preparar contexto para a IA
        const productsContext = products.map(p => 
            `- ${p.name}: ${p.description} | Preço: R$${p.price} | Estoque: ${p.stock} | Imagem: ${p.image_url}`
        ).join('\n');

        const prompt = `Você é um Analista de E-commerce Senior especializado em marketing de luxo.
Sua tarefa é analisar o acervo da "Lumière Haute Parfumerie" e gerar uma estratégia.

TOM DE VOZ DESEJADO: "${tone}"

ACERVO DE PRODUTOS:
${productsContext}

ESTRUTURA DA RESPOSTA (Obrigatório usar HTML sem a tag <body> ou <html>):
1. <h3>💎 Estratégia de Promoções</h3>
   <p>Analise o estoque e sugira quais produtos baixar o preço e a justificativa estratégica.</p>
2. <h3>📱 Posts de Instagram Prontos</h3>
   <ul>
     <li>Crie pelo menos 3 posts focados em conversão.</li>
     <li>Cada post deve incluir a URL da imagem de acordo com o produto.</li>
     <li>Inclua este link de ação direta em cada post: <a href="https://www.instagram.com/reels/create/" target="_blank">Criar Post no Instagram</a></li>
   </ul>

Use o tom "${tone}" em toda a comunicação.`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "nvidia/nemotron-3-super-120b-a12b:free",
                "messages": [{ "role": "user", "content": prompt }]
            })
        });

        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error.message || 'Erro ao conectar com a IA');
        }

        res.json({ content: result.choices[0].message.content });

    } catch (err) {
        console.error('Marketing Assistant Error:', err);
        res.status(500).json({ error: err.message });
    }
});



// =======================
// INTERFACE HTML SERVER
// =======================

const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumière | Haute Parfumerie</title>
    <!-- Premium Fonts: Cormorant Garamond for Serifs, Montserrat for Sans-Serifs -->
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=Montserrat:wght@200;300;400;500&display=swap" rel="stylesheet">
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            /* Luxury Dark Palette */
            --bg-base: #0A0A0A;
            --bg-surface: #121212;
            --bg-glass: rgba(255, 255, 255, 0.02);
            --border-glass: rgba(212, 175, 55, 0.15);
            --bg-gradient-top: #1a1814;
            
            --text-primary: #F9F6F0;
            --text-secondary: #A9A49A;
            
            --accent-gold: #D4AF37;
            --accent-gold-hover: #F2D06B;
            --accent-gold-dim: rgba(212, 175, 55, 0.1);
            
            --danger: #A34848;
            --success: #366147;
            
            /* Typography */
            --font-headings: 'Cormorant Garamond', serif;
            --font-body: 'Montserrat', sans-serif;
        }

        body.light-theme {
            --bg-base: #F9F6F0;
            --bg-surface: #FFFFFF;
            --bg-glass: rgba(0, 0, 0, 0.03);
            --border-glass: rgba(212, 175, 55, 0.3);
            --bg-gradient-top: #FFFFFF;
            
            --text-primary: #121212;
            --text-secondary: #5A564C;
            
            --accent-gold: #A98420;
            --accent-gold-hover: #D4AF37;
            --accent-gold-dim: rgba(212, 175, 55, 0.15);
        }

        body, .card, .modal, .toast, .checkout-container, input, textarea, .payment-card, .table-container, .admin-header, nav {
            transition: background-color 0.8s ease, color 0.8s ease, border-color 0.8s ease, box-shadow 0.8s ease;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--font-body);
            background-color: var(--bg-base);
            color: var(--text-primary);
            line-height: 1.7;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
            background-image: radial-gradient(circle at 50% 0%, var(--bg-gradient-top) 0%, var(--bg-base) 60%);
            background-attachment: fixed;
        }

        h1, h2, h3, .brand {
            font-family: var(--font-headings);
            font-weight: 400;
        }
        
        /* Premium Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--bg-base); }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--accent-gold); }

        /* Navbar */
        nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 2rem 5%;
            background: rgba(10, 10, 10, 0.8);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .brand {
            font-size: 2.2rem;
            letter-spacing: 4px;
            color: var(--accent-gold);
            text-transform: uppercase;
        }

        .nav-links {
            display: flex;
            gap: 2.5rem;
        }

        .nav-links button {
            background: none;
            border: none;
            font-family: var(--font-body);
            font-size: 0.85rem;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.4s ease;
            padding-bottom: 4px;
            position: relative;
        }

        .nav-links button::after {
            content: '';
            position: absolute;
            bottom: 0; left: 50%;
            width: 0; height: 1px;
            background: var(--accent-gold);
            transition: all 0.4s ease;
            transform: translateX(-50%);
        }

        .nav-links button:hover, .nav-links button.active {
            color: var(--text-primary);
        }

        .nav-links button.active::after, .nav-links button:hover::after {
            width: 100%;
        }

        /* Hero Section for Store */
        .hero {
            text-align: center;
            padding: 6rem 1rem 4rem;
            animation: fadeInDown 1s ease-out;
        }

        .hero h2 {
            font-size: 3.5rem;
            color: var(--text-primary);
            margin-bottom: 1rem;
            font-style: italic;
        }

        .hero p {
            color: var(--text-secondary);
            font-size: 1.1rem;
            font-weight: 300;
            letter-spacing: 1px;
            max-width: 600px;
            margin: 0 auto;
        }

        @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Containers */
        .container {
            max-width: 1300px;
            margin: 0 auto 5rem;
            padding: 0 5%;
            flex-grow: 1;
        }

        .section {
            display: none;
            opacity: 0;
            transition: opacity 0.6s ease;
        }

        .section.active {
            display: block;
            opacity: 1;
            animation: fadeIn 0.8s ease forwards;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Luxury Carousel */
        .carousel-container {
            position: relative;
            padding: 2rem 0;
            margin-top: 2rem;
            width: 100%;
        }

        .carousel-viewport {
            overflow: hidden;
            width: 100%;
            padding: 20px 0 40px;
        }

        .carousel-track {
            display: flex;
            transition: transform 0.8s cubic-bezier(0.23, 1, 0.32, 1);
            will-change: transform;
        }

        .carousel-slide {
            flex: 0 0 33.333%;
            padding: 0 1.5rem;
            transition: opacity 0.6s ease, transform 0.6s ease;
        }

        /* Carousel Navigation */
        .carousel-btn {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            background: var(--bg-surface);
            border: 1px solid var(--border-glass);
            color: var(--accent-gold);
            width: 50px;
            height: 50px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 50;
            transition: all 0.4s ease;
            backdrop-filter: blur(8px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
        }

        .carousel-btn:hover {
            border-color: var(--accent-gold);
            background: var(--accent-gold-dim);
            box-shadow: 0 15px 30px rgba(212, 175, 55, 0.2);
        }

        .carousel-btn.prev { left: -25px; }
        .carousel-btn.next { right: -25px; }

        @media (max-width: 1400px) {
            .carousel-btn.prev { left: 10px; }
            .carousel-btn.next { right: 10px; }
        }

        /* Pagination Indicators */
        .carousel-dots {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin-top: 2rem;
        }

        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: rgba(212, 175, 55, 0.2);
            cursor: pointer;
            transition: all 0.4s ease;
            border: 1px solid transparent;
        }

        .dot.active {
            background: var(--accent-gold);
            transform: scale(1.5);
            box-shadow: 0 0 10px var(--accent-gold);
        }

        .card {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: 4px;
            overflow: hidden;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            position: relative;
            height: 100%; /* Garante altura uniforme no slide */
        }

        .card.is-visible {
            opacity: 1;
            transform: translateY(0);
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            box-shadow: 0 0 30px rgba(212, 175, 55, 0);
            transition: box-shadow 0.6s ease;
            pointer-events: none;
            z-index: 10;
        }

        .card.is-visible:hover {
            transform: translateY(-8px) scale(1.02);
            border-color: rgba(212, 175, 55, 0.6);
            background: rgba(255, 255, 255, 0.06);
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            transition-delay: 0s !important;
            z-index: 15;
        }

        .card:hover::before {
            box-shadow: 0 0 30px rgba(212, 175, 55, 0.05) inset;
        }

        .card-img-wrapper {
            overflow: hidden;
            height: 380px;
            position: relative;
            background: #111;
        }

        .status-label {
            position: absolute;
            top: 1rem;
            right: 1rem;
            padding: 0.4rem 1rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            z-index: 20;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            transition: all 0.3s ease;
        }

        .status-available {
            background: rgba(54, 97, 71, 0.85); /* Green */
            color: #FFF;
            border: 1px solid rgba(54, 97, 71, 0.6);
        }

        .status-low {
            background: rgba(212, 175, 55, 0.85); /* Gold/Yellow */
            color: #111;
            border: 1px solid rgba(212, 175, 55, 0.6);
        }

        .status-out {
            background: rgba(50, 50, 50, 0.85); /* Gray */
            color: #A9A49A;
            border: 1px solid rgba(80, 80, 80, 0.6);
        }

        .card-img-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-secondary);
            font-family: var(--font-headings);
            font-style: italic;
            font-size: 1.2rem;
            background-size: cover;
            background-position: center;
            border-bottom: 1px solid rgba(255,255,255,0.03);
            transition: transform 0.7s ease;
        }

        .card:hover .card-img-placeholder {
            transform: scale(1.05);
        }

        .card-content {
            padding: 3rem 2.5rem;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            background: linear-gradient(to top, rgba(10,10,10,0.8), transparent);
            z-index: 2;
        }

        .card-title {
            font-size: 2.2rem;
            font-weight: 400;
            line-height: 1.1;
            margin-bottom: 1.2rem;
            color: var(--accent-gold);
            letter-spacing: 0.5px;
        }

        .card-desc {
            color: var(--text-secondary);
            font-size: 0.95rem;
            font-weight: 300;
            margin-bottom: 2.5rem;
            flex-grow: 1;
            line-height: 1.8;
        }

        .card-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .price {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text-primary);
            font-family: var(--font-body);
            letter-spacing: 2px;
        }

        .stock-badge {
            font-size: 0.7rem;
            padding: 0.4rem 1rem;
            border-radius: 2px;
            background: var(--accent-gold-dim);
            color: var(--accent-gold);
            letter-spacing: 1px;
            text-transform: uppercase;
            border: 1px solid rgba(212, 175, 55, 0.2);
            font-weight: 500;
        }

        .stock-badge.empty {
            background: rgba(163, 72, 72, 0.1);
            color: var(--danger);
            border-color: rgba(163, 72, 72, 0.2);
        }

        /* Buttons */
        .btn {
            background: transparent;
            color: var(--accent-gold);
            border: 1px solid var(--accent-gold);
            padding: 1rem 2rem;
            font-family: var(--font-body);
            font-size: 0.85rem;
            letter-spacing: 2px;
            text-transform: uppercase;
            cursor: pointer;
            transition: all 0.4s ease;
            width: 100%;
            position: relative;
            overflow: hidden;
            z-index: 1;
        }

        .btn::before {
            content: '';
            position: absolute;
            top: 0; left: 0;
            width: 0%; height: 100%;
            background: var(--accent-gold);
            transition: all 0.4s ease;
            z-index: -1;
        }

        .btn:hover::before { width: 100%; }
        .btn:hover { color: var(--bg-base); font-weight: 500; }
        
        .btn:disabled { 
            border-color: rgba(255,255,255,0.1); 
            color: rgba(255,255,255,0.3);
            cursor: not-allowed; 
        }
        .btn:disabled::before { display: none; }
        .btn:disabled:hover { background: transparent; color: rgba(255,255,255,0.3); }

        .btn-solid {
            background: var(--accent-gold);
            color: var(--bg-base);
            font-weight: 500;
        }
        .btn-solid::before { background: var(--text-primary); }
        .btn-solid:hover { color: var(--bg-base); }

        .btn-danger { border-color: var(--danger); color: var(--danger); }
        .btn-danger::before { background: var(--danger); }
        .btn-danger:hover { color: white; border-color: var(--danger); }

        /* Admin Section */
        .admin-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 3rem;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding-bottom: 1.5rem;
        }

        .admin-header h2 {
            font-size: 2.5rem;
            color: var(--text-primary);
            font-style: italic;
        }

        .table-container {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            backdrop-filter: blur(10px);
            border-radius: 4px;
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            min-width: 700px;
        }

        th, td {
            padding: 1.5rem 2rem;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        th { 
            font-family: var(--font-body);
            font-weight: 400; 
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: var(--text-secondary); 
            background: rgba(0,0,0,0.4);
        }
        
        td { color: var(--text-primary); font-weight: 300; }
        
        .td-name { font-family: var(--font-headings); font-size: 1.4rem; color: var(--accent-gold); }
        .td-price { font-family: var(--font-headings); font-size: 1.2rem; }

        .table-actions {
            display: flex;
            gap: 1rem;
        }

        .table-actions .btn {
            width: auto;
            padding: 0.6rem 1.2rem;
            font-size: 0.75rem;
        }

        /* Forms / Modals */
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }

        .modal {
            background: var(--bg-surface);
            padding: 3rem;
            border: 1px solid var(--border-glass);
            border-radius: 4px;
            width: 90%;
            max-width: 600px;
            box-shadow: 0 30px 60px rgba(0,0,0,0.5);
            animation: modalIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        @keyframes modalIn {
            from { opacity: 0; transform: scale(0.95) translateY(20px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .modal h2 { 
            margin-bottom: 2rem; 
            color: var(--accent-gold); 
            font-size: 2.2rem;
            text-align: center;
            font-style: italic;
        }

        .form-group { margin-bottom: 1.5rem; }
        .form-group label { 
            display: block; 
            margin-bottom: 0.6rem; 
            font-size: 0.8rem; 
            letter-spacing: 1px;
            text-transform: uppercase;
            color: var(--text-secondary); 
        }
        .form-group input, .form-group textarea {
            width: 100%;
            padding: 1rem;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 2px;
            font-family: var(--font-body);
            background: rgba(0,0,0,0.3);
            color: var(--text-primary);
            transition: all 0.3s ease;
        }
        .form-group input:focus, .form-group textarea:focus {
            outline: none;
            border-color: var(--accent-gold);
            background: rgba(0,0,0,0.5);
        }
        .form-group textarea { resize: vertical; min-height: 120px; }
        
        .modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 1.5rem;
            margin-top: 3rem;
        }

        .modal-actions .btn { width: auto; }

        /* Confirm Delete Modal */
        .confirm-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 2000;
        }

        .confirm-modal {
            background: var(--bg-surface);
            padding: 3rem;
            border: 1px solid var(--border-glass);
            border-radius: 4px;
            width: 90%;
            max-width: 450px;
            text-align: center;
            box-shadow: 0 30px 60px rgba(0,0,0,0.6);
            animation: modalIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .confirm-modal h3 {
            color: var(--danger);
            font-family: var(--font-headings);
            font-size: 2.2rem;
            margin-bottom: 1rem;
            font-style: italic;
        }

        .confirm-modal p {
            color: var(--text-primary);
            font-weight: 300;
            margin-bottom: 2rem;
            line-height: 1.6;
        }

        .confirm-actions {
            display: flex;
            justify-content: center;
            gap: 1.5rem;
        }

        /* Checkout Section */
        .checkout-container {
            max-width: 800px;
            margin: 0 auto;
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: 4px;
            padding: 3rem;
            backdrop-filter: blur(10px);
        }
        
        .checkout-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .checkout-section-title {
            color: var(--accent-gold);
            font-family: var(--font-headings);
            font-size: 1.8rem;
            margin-bottom: 1.5rem;
            font-style: italic;
            grid-column: 1 / -1;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding-bottom: 0.5rem;
        }

        .payment-method-selector {
            grid-column: 1 / -1;
            display: flex;
            gap: 1.5rem;
            margin-bottom: 1.5rem;
        }

        .payment-card {
            flex: 1;
            border: 1px solid rgba(255,255,255,0.1);
            padding: 1.5rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            color: var(--text-secondary);
        }

        .payment-card.active {
            border-color: var(--accent-gold);
            color: var(--text-primary);
            background: rgba(212, 175, 55, 0.05);
        }

        .payment-details {
            grid-column: 1 / -1;
            display: none;
            flex-direction: column;
            gap: 1.5rem;
            animation: fadeIn 0.4s ease forwards;
        }

        .payment-details.active {
            display: flex;
        }

        .qr-placeholder {
            width: 200px;
            height: 200px;
            background: #fff;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
        }
        .qr-placeholder img { width: 100%; height: 100%; object-fit: contain; }

        /* Notificações (Toasts) */
        .toast {
            position: fixed;
            bottom: 40px;
            right: 40px;
            background: var(--bg-surface);
            border: 1px solid var(--accent-gold);
            color: var(--text-primary);
            padding: 1.2rem 2rem;
            box-shadow: 0 15px 35px rgba(0,0,0,0.4);
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 2000;
            font-family: var(--font-body);
            font-size: 0.9rem;
            letter-spacing: 1px;
        }
        
        .toast::before {
            content: '';
            position: absolute;
            left: 0; top: 0; bottom: 0;
            width: 4px;
            background: var(--accent-gold);
        }

        .toast.show {
            transform: translateY(0);
            opacity: 1;
        }
        .toast.error { border-color: var(--danger); }
        .toast.error::before { background: var(--danger); }

        /* Loader */
        .loader {
            text-align: center;
            padding: 5rem;
            color: var(--accent-gold);
            font-family: var(--font-headings);
            font-size: 1.5rem;
            font-style: italic;
            letter-spacing: 2px;
            grid-column: 1 / -1;
        }

        /* Button Spinner */
        .btn-spinner {
            display: inline-block;
            width: 1rem;
            height: 1rem;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: var(--accent-gold);
            animation: spin 1s ease-in-out infinite;
            vertical-align: middle;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Responsividade Abrangente */
        @media (max-width: 1024px) {
            .carousel-slide { flex: 0 0 50%; }
            .container { padding: 0 3%; }
        }

        @media (max-width: 768px) {
            nav { padding: 1.5rem 5%; flex-direction: column; gap: 1.5rem; text-align: center; }
            .nav-links { gap: 1.2rem; flex-wrap: wrap; justify-content: center; }
            .brand { font-size: 1.8rem; margin-bottom: 0.5rem; }
            
            .hero { padding: 4rem 1rem 2rem; }
            .hero h2 { font-size: 2.2rem; }
            .hero p { font-size: 0.95rem; }

            .carousel-slide { flex: 0 0 100%; padding: 0 1rem; }
            .card-content { padding: 2rem 1.5rem; }
            .card-title { font-size: 1.8rem; }
            .card-img-wrapper { height: 320px; }

            .checkout-container, .marketing-assistant-container, .modal { padding: 1.5rem; width: 95%; }
            .checkout-grid { grid-template-columns: 1fr; }
            .payment-method-selector { flex-direction: column; gap: 0.8rem; }
            
            .admin-header { flex-direction: column; align-items: stretch; gap: 1rem; text-align: center; }
            .admin-header h2 { font-size: 2rem; }
            .table-actions { flex-direction: column; width: 100%; }
            .table-actions .btn { width: 100%; }

            .toast { bottom: 20px; right: 20px; left: 20px; text-align: center; padding: 1rem; }
        }

        @media (max-width: 480px) {
            .brand { font-size: 1.5rem; letter-spacing: 2px; }
            .nav-links { gap: 0.8rem; }
            .nav-links button { font-size: 0.75rem; letter-spacing: 1px; }
            .hero h2 { font-size: 1.8rem; }
            .card-title { font-size: 1.5rem; }
            .price { font-size: 1rem; }
        }

        /* Marketing Assistant Styles */
        .marketing-assistant-container {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: 4px;
            padding: 3rem;
            backdrop-filter: blur(10px);
            margin-top: 2rem;
            max-width: 900px;
            margin-left: auto;
            margin-right: auto;
        }
        .ia-response-area {
            margin-top: 3rem;
            padding: 2.5rem;
            background: rgba(0,0,0,0.4);
            border-radius: 4px;
            border-left: 3px solid var(--accent-gold);
            min-height: 200px;
            color: var(--text-primary);
            line-height: 1.8;
            animation: fadeIn 0.6s ease;
        }
        .ia-response-area h3 {
            color: var(--accent-gold);
            margin-top: 2.5rem;
            margin-bottom: 1.2rem;
            font-size: 1.8rem;
            font-family: var(--font-headings);
            font-style: italic;
        }
        .ia-response-area h3:first-child { margin-top: 0; }
        .ia-response-area p { margin-bottom: 1.2rem; font-weight: 300; }
        .ia-response-area ul { margin-left: 1.5rem; margin-bottom: 1.8rem; list-style-type: none; }
        .ia-response-area li { margin-bottom: 1rem; position: relative; padding-left: 1.5rem; }
        .ia-response-area li::before { content: '✨'; position: absolute; left: 0; color: var(--accent-gold); }
        .ia-response-area a { 
            color: var(--accent-gold); 
            text-decoration: none; 
            font-weight: 500;
            border-bottom: 1px solid var(--accent-gold-dim); 
            transition: all 0.3s; 
            padding: 2px 4px;
            background: rgba(212, 175, 55, 0.05);
        }
        .ia-response-area a:hover { 
            color: var(--bg-base); 
            background: var(--accent-gold);
            border-bottom-color: var(--accent-gold); 
        }

    </style>
</head>
<body>

    <nav>
        <div class="brand">Lumière</div>
        <div class="nav-links">
            <button id="theme-toggle" onclick="toggleTheme()" title="Alternar Tema" style="padding: 0 5px; display: flex; align-items: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            </button>
            <button class="active" onclick="showSection('store')">La Boutique</button>
            <button onclick="handleAdminAccess()">L'Administration</button>
        </div>


    </nav>

    <div class="container">
        <!-- Store Section -->
        <div id="store-section" class="section active">
            <div class="hero">
                <h2>L'Essence du Luxe</h2>
                <p>Descubra nossa coleção exclusiva de velas aromáticas artesanais, criadas para iluminar e perfumar seus momentos mais preciosos.</p>
            </div>
            
            <div id="carousel-wrapper" class="carousel-container">
                <button class="carousel-btn prev" onclick="moveCarousel(-1)" aria-label="Anterior">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                
                <div class="carousel-viewport">
                    <div id="products-track" class="carousel-track">
                        <div class="loader">Despertando as essências...</div>
                    </div>
                </div>

                <button class="carousel-btn next" onclick="moveCarousel(1)" aria-label="Próximo">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>

                <div id="carousel-dots" class="carousel-dots"></div>
            </div>
        </div>

        <!-- Checkout Section -->
        <div id="checkout-section" class="section">
            <div class="hero" style="padding: 4rem 1rem 2rem;">
                <h2>Finalizar Aquisição</h2>
            </div>
            <div class="checkout-container">
                <form id="checkout-form" onsubmit="processCheckout(event)">
                    <div class="checkout-grid">
                        <h3 class="checkout-section-title">Endereço de Entrega</h3>
                        <div class="form-group" style="grid-column: 1/-1;">
                            <label>Rua / Avenida</label>
                            <input type="text" required placeholder="Ex: Av. Paulista, 1000">
                        </div>
                        <div class="form-group">
                            <label>Número</label>
                            <input type="text" required>
                        </div>
                        <div class="form-group">
                            <label>CEP</label>
                            <input type="text" required>
                        </div>
                        <div class="form-group" style="grid-column: 1/-1;">
                            <label>Complemento / Bairro</label>
                            <input type="text">
                        </div>

                        <h3 class="checkout-section-title">Método de Pagamento</h3>
                        <div class="payment-method-selector">
                            <div class="payment-card active" onclick="selectPayment('pix')" id="card-pix">Pix</div>
                            <div class="payment-card" onclick="selectPayment('credit')" id="card-credit">Cartão de Crédito</div>
                        </div>

                        <div id="details-pix" class="payment-details active">
                            <div style="text-align:center;">
                                <p style="margin-bottom:1rem;">Escaneie o QR Code abaixo para concluir a reserva.</p>
                                <div class="qr-placeholder">
                                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=00020126360014BR.GOV.BCB.PIX0114+55119999999995204000053039325802BR5902BR600500.006209SAO+PAULO630400006803***" alt="QR Code Pix">
                                </div>
                            </div>
                        </div>

                        <div id="details-credit" class="payment-details">
                            <div class="form-group" style="grid-column: 1/-1;">
                                <label>Número do Cartão</label>
                                <input type="text" placeholder="0000 0000 0000 0000">
                            </div>
                            <div style="display: flex; gap: 1.5rem; grid-column: 1/-1;">
                                <div class="form-group" style="flex:1;">
                                    <label>Validade</label>
                                    <input type="text" placeholder="MM/AA">
                                </div>
                                <div class="form-group" style="flex:1;">
                                    <label>CVV</label>
                                    <input type="text" placeholder="123">
                                </div>
                            </div>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-solid" id="checkout-btn" style="width: 100%; margin-top: 1rem;">Confirmar Pedido</button>
                    <button type="button" class="btn border-none" style="width: 100%; margin-top: 1rem; border: none; font-size: 0.75rem" onclick="showSection('store')">Voltar à Loja</button>
                </form>
            </div>
        </div>

        <!-- Admin Section -->
        <div id="admin-section" class="section">
            <div class="hero" style="padding: 4rem 1rem 2rem;">
                <h2>Gestão Exclusiva</h2>
            </div>
            
            <div class="chart-container" style="position: relative; height:350px; width:100%; margin-bottom: 3rem; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 4px; padding: 1.5rem; backdrop-filter: blur(10px);">
                <canvas id="stockChart"></canvas>
            </div>

            <div class="admin-header">
                <div></div>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn" style="width: auto; margin:0;" onclick="toggleMarketing()">Assistência IA</button>
                    <button class="btn btn-solid" style="width: auto; margin:0;" onclick="openProductModal()">Adicionar Criação</button>
                </div>
            </div>

            <div id="marketing-container" class="marketing-assistant-container" style="display: none; margin-bottom: 3rem;">
                <div class="form-group">
                    <label>Tom de Voz Desejado</label>
                    <input type="text" id="marketing-tone" placeholder="Ex: Sofisticado, Irônico, Minimalista, Urgente..." value="Sofisticado e Exclusivo">
                </div>
                <button class="btn btn-solid" id="generate-marketing-btn" onclick="generateMarketingStrategy()">
                    Gerar Estratégia de Vendas
                </button>

                <div id="ia-response-container" class="ia-response-area" style="display: none;">
                    <!-- Resposta da IA será injetada aqui -->
                </div>
            </div>

            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Criação</th>
                            <th>Valor</th>
                            <th>Disponibilidade</th>
                            <th>Intervenções</th>
                        </tr>
                    </thead>
                    <tbody id="admin-table-body">
                        <!-- Table rows injected here -->
                    </tbody>
                </table>
            </div>
        </div>

        </div>
    </div>



    <!-- Product Modal -->
    <div id="product-modal" class="modal-overlay">
        <div class="modal">
            <h2 id="modal-title">Nova Criação</h2>
            <form id="product-form" onsubmit="saveProduct(event)">
                <input type="hidden" id="product-id">
                
                <div class="form-group">
                    <label>Nomenclatura da Obra</label>
                    <input type="text" id="product-name" required placeholder="Ex: Vanille Royale">
                </div>
                
                <div class="form-group">
                    <label>Notas Olfativas</label>
                    <textarea id="product-desc" placeholder="Descreva os acordes florais, madeiras raras e especiarias..."></textarea>
                </div>
                
                <div style="display: flex; gap: 1.5rem;">
                    <div class="form-group" style="flex: 1;">
                        <label>Valor (R$)</label>
                        <input type="number" id="product-price" step="0.01" required placeholder="0.00">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Estoque (un)</label>
                        <input type="number" id="product-stock" required placeholder="0" min="0">
                    </div>
                </div>

                <div class="form-group">
                    <label>Arte Visual (Imagem)</label>
                    <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem;">
                        <input type="url" id="product-image" placeholder="URL da Imagem" oninput="updateImagePreview()" style="flex: 1;">
                        <span style="opacity: 0.5; font-size: 0.8rem;">OU</span>
                        <label for="product-file" class="btn" style="width: auto; margin: 0; padding: 0.6rem 1rem; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">
                            Upload Local
                        </label>
                        <input type="file" id="product-file" accept="image/*" style="display: none;" onchange="handleFileSelect(event)">
                    </div>
                    <div id="image-preview-container" style="margin-top: 1rem; text-align: center; display: none;">
                        <div id="upload-status" style="font-size: 0.75rem; color: var(--accent-gold); margin-bottom: 0.5rem; display: none;">Enviando arquivo...</div>
                        <img id="image-preview" src="" alt="Prévia" style="max-width: 100%; max-height: 200px; border-radius: 4px; border: 1px solid var(--border-glass); object-fit: contain; background: rgba(0,0,0,0.2);">
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
                    <button type="submit" class="btn btn-solid">Preservar Criação</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Confirm Delete Modal -->
    <div id="confirm-modal" class="confirm-modal-overlay">
        <div class="confirm-modal">
            <h3>Expurgar Criação</h3>
            <p>Tens a certeza de que desejas erradicar esta obra do acervo? Esta ação é irreversível.</p>
            <div class="confirm-actions">
                <button class="btn" onclick="closeConfirmModal()">Repensar</button>
                <button class="btn btn-danger" id="confirm-delete-btn">Prosseguir</button>
            </div>
        </div>
    </div>

    <div id="toast" class="toast">Notificação padrão</div>

    <script>
        let adminToken = '';
        let stockChartInstance = null;
        // No Netlify, usamos caminhos relativos à raiz pois o netlify.toml redireciona tudo para a função
        const BASE_URL = '';
        const API_URL = \`\${BASE_URL}/api/products\`;

        // Carousel State
        let carouselIndex = 0;
        let carouselAutoplayInterval = null;
        let productsCount = 0;
        let slidesVisible = 3;


        // ========== Utilities ==========
        const formatMoney = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
        
        const summarizeText = (text, maxLength = 80) => {
            if (!text) return 'Uma fragrância envolvente e atemporal.';
            return text.length > maxLength ? text.substring(0, maxLength).trim() + '...' : text;
        };

        const svgSun = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
        const svgMoon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

        const toggleTheme = () => {
            document.body.classList.toggle('light-theme');
            const toggleBtn = document.getElementById('theme-toggle');
            if(document.body.classList.contains('light-theme')) {
                toggleBtn.innerHTML = svgMoon;
            } else {
                toggleBtn.innerHTML = svgSun;
            }
        };

        const showToast = (message, isError = false) => {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast show ' + (isError ? 'error' : '');
            setTimeout(() => toast.className = 'toast', 3000);
        };

        const showSection = (sectionId) => {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            // trigger reflow para a animação reiniciar
            void document.getElementById(sectionId + '-section').offsetWidth;
            document.getElementById(sectionId + '-section').classList.add('active');
            
            const buttons = document.querySelectorAll('.nav-links button');
            // O primeiro botão (índice 0) é o Toggle Theme, os outros são seções
            if(buttons[1]) buttons[1].classList.toggle('active', sectionId === 'store');
            if(buttons[2]) buttons[2].classList.toggle('active', sectionId === 'admin');



            if(sectionId === 'store') loadStoreProducts();
            if(sectionId === 'admin') loadAdminProducts();
        };

        const handleAdminAccess = () => {
            if(adminToken) {
                showSection('admin');
                return;
            }

            const pass = prompt("Para adentrar a câmara de administração, por favor, insira a chave:");
            if(pass === 'Ruthiely2012') {
                adminToken = pass;
                showToast('Acesso Exclusivo Concedido.');
                showSection('admin');
            } else if(pass !== null) {
                showToast('Chave Incorreta. Acesso Negado.', true);
            }
        };

        const authHeaders = () => ({
            'Content-Type': 'application/json',
            'X-Admin-Password': adminToken
        });

        const fetchProducts = async () => {
            try {
                const res = await fetch(API_URL);
                if(!res.ok) throw new Error('Ocorreu uma falha ao evocar as coleções.');
                return await res.json();
            } catch (err) {
                showToast(err.message, true);
                return [];
            }
        };

        // ========== Store Logic ==========
        const updateSlidesVisible = () => {
            if (window.innerWidth <= 768) slidesVisible = 1;
            else if (window.innerWidth <= 1024) slidesVisible = 2;
            else slidesVisible = 3;
        };

        const updateCarousel = () => {
            const track = document.getElementById('products-track');
            if (!track) return;
            
            const maxIndex = Math.max(0, productsCount - slidesVisible);
            if (carouselIndex > maxIndex) carouselIndex = maxIndex;
            if (carouselIndex < 0) carouselIndex = 0;

            const slideWidth = 100 / slidesVisible;
            track.style.transform = \`translateX(-\${carouselIndex * slideWidth}%)\`;

            // Update dots
            document.querySelectorAll('.dot').forEach((dot, idx) => {
                dot.classList.toggle('active', idx === carouselIndex);
            });

            // Luxury effects
            document.querySelectorAll('.carousel-slide').forEach((slide, idx) => {
                const isVisible = idx >= carouselIndex && idx < carouselIndex + slidesVisible;
                slide.style.opacity = isVisible ? '1' : '0.4';
                slide.style.transform = isVisible ? 'scale(1)' : 'scale(0.9)';
            });
        };

        const moveCarousel = (direction) => {
            const maxIndex = Math.max(0, productsCount - slidesVisible);
            carouselIndex += direction;
            
            if (carouselIndex > maxIndex) carouselIndex = 0;
            if (carouselIndex < 0) carouselIndex = maxIndex;
            
            updateCarousel();
            resetAutoplay();
        };

        const goToSlide = (index) => {
            carouselIndex = index;
            updateCarousel();
            resetAutoplay();
        };

        const startAutoplay = () => {
            stopAutoplay();
            carouselAutoplayInterval = setInterval(() => {
                moveCarousel(1);
            }, 6000); 
        };

        const stopAutoplay = () => {
            if (carouselAutoplayInterval) clearInterval(carouselAutoplayInterval);
        };

        const resetAutoplay = () => {
            startAutoplay();
        };

        const loadStoreProducts = async () => {
            const track = document.getElementById('products-track');
            const dotsContainer = document.getElementById('carousel-dots');
            if (!track) return;
            track.innerHTML = '<div class="loader">Despertando as essências...</div>';
            
            const products = await fetchProducts();
            productsCount = products.length;
            updateSlidesVisible();
            
            if (products.length === 0) {
                track.innerHTML = '<div class="loader" style="color: var(--text-secondary); font-size: 1.1rem;">A galeria encontra-se vazia, no aguardo da próxima coleção.</div>';
                if (dotsContainer) dotsContainer.innerHTML = '';
                return;
            }

            // Render Slides
            track.innerHTML = products.map((p, index) => {
                const stock = p.stock;
                const isOut = stock <= 0;
                let statusClass = 'available';
                let statusText = 'Disponível';
                if (stock <= 0) {
                    statusClass = 'out';
                    statusText = 'Esgotado';
                } else if (stock <= 5) {
                    statusClass = 'low';
                    statusText = 'Últimas Unidades';
                }

                const imgStyle = p.image_url ? \`background-image: url('\${p.image_url}');\` : '';
                return \`
                <div class="carousel-slide" data-index="\${index}">
                    <div class="card is-visible">
                        <div class="card-img-wrapper">
                            <span class="status-label status-\${statusClass}">\${statusText}</span>
                            <div class="card-img-placeholder" style="\${imgStyle}">
                                \${!p.image_url ? 'Imaginário' : ''}
                            </div>
                        </div>
                        <div class="card-content">
                            <h3 class="card-title">\${p.name}</h3>
                            <p class="card-desc">\${p.description || 'Uma fragrância envolvente e atemporal.'}</p>
                            <div class="card-footer">
                                <span class="price">\${formatMoney(p.price)}</span>
                                <span class="stock-badge \${isOut ? 'empty' : ''}">
                                    \${isOut ? 'Esgotado' : p.stock + ' Disponíveis'}
                                </span>
                            </div>
                            <button class="btn" \${isOut ? 'disabled' : ''} onclick="goToCheckout('\${p.id}')">
                                \${isOut ? 'Aguardando Fornada' : 'Adquirir Obra'}
                            </button>
                        </div>
                    </div>
                </div>\`;
            }).join('');

            // Render Dots
            if (dotsContainer) {
                dotsContainer.innerHTML = products.map((_, index) => {
                    const maxIndex = Math.max(0, productsCount - slidesVisible);
                    if (index > maxIndex && maxIndex > 0 && productsCount > slidesVisible) return '';
                    return \`<div class="dot \${index === 0 ? 'active' : ''}" onclick="goToSlide(\${index})"></div>\`;
                }).join('');
            }

            carouselIndex = 0;
            updateCarousel();
            startAutoplay();

            // Pause on hover
            const wrapper = document.getElementById('carousel-wrapper');
            if (wrapper) {
                wrapper.onmouseenter = stopAutoplay;
                wrapper.onmouseleave = startAutoplay;
            }
        };

        window.addEventListener('resize', () => {
            updateSlidesVisible();
            updateCarousel();
        });

        let currentCheckoutProductId = null;

        const goToCheckout = (id) => {
            currentCheckoutProductId = id;
            showSection('checkout');
            window.scrollTo(0, 0); // Sobe para o topo
        };

        const selectPayment = (method) => {
            document.getElementById('card-pix').classList.remove('active');
            document.getElementById('card-credit').classList.remove('active');
            document.getElementById('details-pix').classList.remove('active');
            document.getElementById('details-credit').classList.remove('active');

            if(method === 'pix') {
                document.getElementById('card-pix').classList.add('active');
                document.getElementById('details-pix').classList.add('active');
            } else {
                document.getElementById('card-credit').classList.add('active');
                document.getElementById('details-credit').classList.add('active');
            }
        };

        const processCheckout = async (e) => {
            e.preventDefault();
            if(!currentCheckoutProductId) return;

            const btn = document.getElementById('checkout-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="btn-spinner"></span> Processando...';
            btn.disabled = true;

            try {
                const res = await fetch(\`\${API_URL}/\${currentCheckoutProductId}/sell\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                
                if(!res.ok) throw new Error(data.error);
                
                showToast('Aquisição concluída! Sua obra foi reservada com sucesso.');
                
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    document.getElementById('checkout-form').reset();
                    showSection('store');
                    loadStoreProducts(); 
                }, 2000);
                
            } catch (err) {
                showToast(err.message, true);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        };

        // ========== Admin Logic ==========
        const renderStockChart = (products) => {
            const ctx = document.getElementById('stockChart').getContext('2d');
            if(stockChartInstance) {
                stockChartInstance.destroy();
            }

            const labels = products.map(p => p.name);
            const stockData = products.map(p => p.stock);

            stockChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Unidades Disponíveis',
                        data: stockData,
                        backgroundColor: 'rgba(212, 175, 55, 0.6)',
                        borderColor: '#D4AF37',
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: 0.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { 
                            labels: { color: '#F9F6F0', font: { family: "'Montserrat', sans-serif" } }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#A9A49A', stepSize: 1, font: { family: "'Montserrat', sans-serif" } }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#A9A49A', font: { family: "'Montserrat', sans-serif" } }
                        }
                    }
                }
            });
        };

        const loadAdminProducts = async () => {
            const tbody = document.getElementById('admin-table-body');
            tbody.innerHTML = '<tr><td colspan="4" class="loader" style="font-size:1.1rem">Organizando o acervo...</td></tr>';
            
            const products = await fetchProducts();
            
            if (products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="loader" style="font-size:1.1rem; color:var(--text-secondary)">Sem acervos a exibir.</td></tr>';
                if(stockChartInstance) { stockChartInstance.destroy(); stockChartInstance = null; }
                return;
            }

            renderStockChart(products);

            tbody.innerHTML = products.map(p => {
                const productJSON = JSON.stringify(p).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
                
                return \`
                <tr>
                    <td class="td-name">\${p.name}</td>
                    <td class="td-price">\${formatMoney(p.price)}</td>
                    <td><span class="stock-badge \${p.stock <= 0 ? 'empty' : ''}">\${p.stock} un.</span></td>
                    <td>
                        <div class="table-actions">
                            <button class="btn" onclick='editProduct(\${productJSON})'>Refinar</button>
                            <button class="btn btn-danger" onclick="deleteProduct('\${p.id}')">Remover</button>
                        </div>
                    </td>
                </tr>
            \`}).join('');
        };

        const handleFileSelect = (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.getElementById('image-preview');
                const container = document.getElementById('image-preview-container');
                img.src = e.target.result;
                container.style.display = 'block';
                // Limpa o campo de URL se estiver sendo usado upload
                document.getElementById('product-image').value = '';
            };
            reader.readAsDataURL(file);
        };

        const updateImagePreview = () => {
            const url = document.getElementById('product-image').value;
            const container = document.getElementById('image-preview-container');
            const img = document.getElementById('image-preview');
            
            if (url && url.trim() !== '') {
                img.src = url;
                container.style.display = 'block';
                // Limpa o input de arquivo se estiver usando URL
                document.getElementById('product-file').value = '';
            } else if (!document.getElementById('product-file').files[0]) {
                img.src = '';
                container.style.display = 'none';
            }
        };

        const openProductModal = (product = null) => {
            const modal = document.getElementById('product-modal');
            const form = document.getElementById('product-form');
            form.reset();
            
            if(product) {
                document.getElementById('modal-title').textContent = 'Refinar Criação';
                document.getElementById('product-id').value = product.id;
                document.getElementById('product-name').value = product.name;
                document.getElementById('product-desc').value = product.description;
                document.getElementById('product-price').value = product.price;
                document.getElementById('product-stock').value = product.stock;
                document.getElementById('product-image').value = product.image_url || '';
            } else {
                document.getElementById('modal-title').textContent = 'Nova Criação';
                document.getElementById('product-id').value = '';
                document.getElementById('product-image').value = '';
            }
            document.getElementById('product-file').value = '';
            document.getElementById('upload-status').style.display = 'none';
            
            updateImagePreview();
            modal.style.display = 'flex';
        };

        const closeModal = () => {
            document.getElementById('product-modal').style.display = 'none';
        };

        const editProduct = (productStr) => {
            const product = typeof productStr === 'string' ? JSON.parse(productStr) : productStr;
            openProductModal(product);
        };

        const saveProduct = async (e) => {
            e.preventDefault();
            const id = document.getElementById('product-id').value;
            const fileInput = document.getElementById('product-file');
            let imageUrl = document.getElementById('product-image').value;

            try {
                // 1. Upload de Imagem se houver arquivo selecionado
                if (fileInput.files.length > 0) {
                    const status = document.getElementById('upload-status');
                    status.style.display = 'block';
                    
                    const formData = new FormData();
                    formData.append('image', fileInput.files[0]);

                    const uploadRes = await fetch('/api/upload', {
                        method: 'POST',
                        headers: { 'x-admin-password': 'Ruthiely2012' }, 
                        body: formData
                    });

                    if (!uploadRes.ok) {
                        const errData = await uploadRes.json();
                        throw new Error(errData.error || 'Falha no upload da imagem.');
                    }

                    const uploadData = await uploadRes.json();
                    imageUrl = uploadData.url;
                    status.style.display = 'none';
                }

                // 2. Preparar Payload
                const payload = {
                    name: document.getElementById('product-name').value,
                    description: document.getElementById('product-desc').value,
                    price: parseFloat(document.getElementById('product-price').value),
                    stock: parseInt(document.getElementById('product-stock').value, 10),
                    image_url: imageUrl
                };

                // 3. Salvar Produto
                const method = id ? 'PUT' : 'POST';
                const url = id ? \`\${API_URL}/\${id}\` : API_URL;

                const res = await fetch(url, {
                    method,
                    headers: authHeaders(),
                    body: JSON.stringify(payload)
                });
                
                if(!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Erro nas catacumbas do servidor.');
                }
                
                showToast(\`Criação \${id ? 'refinada' : 'imortalizada'} com requinte.\`);
                closeModal();
                loadAdminProducts(); 

            } catch (err) {
                if(err.message.includes('Não autorizado')) {
                    adminToken = '';
                    showSection('store');
                }
                showToast(err.message, true);
            }
        };

        let productToDeleteId = null;

        const openConfirmModal = (id) => {
            productToDeleteId = id;
            document.getElementById('confirm-modal').style.display = 'flex';
        };

        const closeConfirmModal = () => {
            productToDeleteId = null;
            document.getElementById('confirm-modal').style.display = 'none';
        };

        const deleteProduct = async (id) => {
            openConfirmModal(id);
        };

        document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
            if(!productToDeleteId) return;
            const id = productToDeleteId;
            closeConfirmModal();

            try {
                const res = await fetch(\`\${API_URL}/\${id}\`, {
                    method: 'DELETE',
                    headers: authHeaders()
                });
                
                if(!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Falha ao erradicar.');
                }
                
                showToast('A obra foi silenciada com sucesso.');
                loadAdminProducts();
            } catch (err) {
                if(err.message.includes('Não autorizado')) {
                    adminToken = '';
                    showSection('store');
                }
                showToast(err.message, true);
            }
        });

        const toggleMarketing = () => {
            const container = document.getElementById('marketing-container');
            if(container.style.display === 'none') {
                container.style.display = 'block';
                // Scroll suave para o assistente
                container.scrollIntoView({ behavior: 'smooth' });
            } else {
                container.style.display = 'none';
            }
        };


        const generateMarketingStrategy = async () => {
            const tone = document.getElementById('marketing-tone').value;
            const btn = document.getElementById('generate-marketing-btn');
            const container = document.getElementById('ia-response-container');
            
            if(!tone) {
                showToast('Por favor, defina um tom de voz para a IA.', true);
                return;
            }

            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="btn-spinner"></span> Consultando a IA...';
            btn.disabled = true;
            
            container.style.display = 'block';
            container.innerHTML = '<div class="loader">Analisando produtos e tecendo a estratégia perfeita...</div>';

            try {
                const res = await fetch(\`\${BASE_URL}/admin/ia-marketing\`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ tone })
                });

                const data = await res.json();
                
                if(!res.ok) throw new Error(data.error || 'Falha na comunicação com a IA.');

                container.innerHTML = data.content;
                showToast('Estratégia de Marketing gerada com sucesso.');
                
            } catch (err) {
                showToast(err.message, true);
                container.innerHTML = '<p style="color:var(--danger); text-align:center; padding: 2rem;">Erro ao gerar estratégia: ' + err.message + '</p>';
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        };

        // ========== Initialization ==========
        loadStoreProducts();

    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
});

// Exportar para o Netlify Functions
module.exports.handler = serverless(app);

// Inicia servidor apenas se rodado diretamente (local)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`\n========================================`);
        console.log(`✨ Lumière Haute Parfumerie rodando LOCAL na porta ${port}`);
        console.log(`========================================\n`);
    });
}
