-- Este script deve ser executado no SQL Editor do Supabase para criar a tabela inicial

CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Como nosso backend utiliza a service_role key ou gerencia tudo internamente,
-- a tabela pode permanecer com RLS desativado ou, para maior segurança:
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Permite que nossa API (usando anon key) acesse e modifique os dados 
-- Em produção, o ideal é que apenas requisições autenticadas possam alterar (INSERT/UPDATE/DELETE).
-- O Nodejs. já protege as rotas de alteração com a senha, então podemos permitir as operações no DB se o backend for o único cliente.

CREATE POLICY "Permitir leitura para todos" 
ON products FOR SELECT USING (true);

-- Se for utilizar a service_role no backend, não precisa de mais policies, pois ela bypassa RLS.
-- Caso utilize a anon_key no .env, você precisará adicionar políticas para INSERT, UPDATE e DELETE:
CREATE POLICY "Permitir alteração geral (pois o node.js gerencia auth)" 
ON products FOR ALL USING (true);


-- ==========================================
-- CONFIGURAÇÃO DE STORAGE (Para imagens locais)
-- ==========================================

-- 1. Criação do Bucket 'product-images' (Público)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Políticas de Acesso para Storage (objects)

-- Permite leitura pública (Todos podem ver as fotos)
CREATE POLICY "Leitura Pública de Imagens"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Permite inserção/atualização/deleção para o backend (Admin)
-- Como o Node.js gerencia o adminAuth, permitimos acesso geral nestas policies 
-- se você estiver usando a anon key no .env.

CREATE POLICY "Inserção de Imagens (Admin)"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Atualização de Imagens (Admin)"
ON storage.objects FOR UPDATE
USING (bucket_id = 'product-images');

CREATE POLICY "Remoção de Imagens (Admin)"
ON storage.objects FOR DELETE
USING (bucket_id = 'product-images');
