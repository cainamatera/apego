require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();
const port = 3000;

app.set('view engine', 'ejs');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'uma-chave-muito-secreta-e-dificil-de-adivinhar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const checarSeAdminLogado = (req, res, next) => {
    if (req.session.adminId) {
        next();
    } else {
        res.redirect('/login.html');
    }
};

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query('SELECT * FROM administradores WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.redirect('/login.html?error=1');
        }
        const admin = result.rows[0];
        const senhaValida = await bcrypt.compare(senha, admin.senha_hash);
        if (!senhaValida) {
            return res.redirect('/login.html?error=1');
        }
        req.session.adminId = admin.id;
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).send('Ocorreu um erro no servidor.');
    }
});

app.get('/dashboard', checarSeAdminLogado, async (req, res) => {
    try {
        const totalCasasResult = await pool.query('SELECT COUNT(*) FROM casas');
        const casasAlugadasResult = await pool.query("SELECT COUNT(*) FROM casas WHERE status = 'alugada'");
        const totalCasas = totalCasasResult.rows[0].count;
        const casasAlugadas = casasAlugadasResult.rows[0].count;
        res.render('dashboard', {
            success: req.query.success,
            error: req.query.error,
            totalCasas: totalCasas,
            casasAlugadas: casasAlugadas
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).send("Erro ao carregar o painel.");
    }
});

app.post('/casas', checarSeAdminLogado, upload.array('imagens', 10), async (req, res) => {
    const { titulo, endereco, descricao, valor_mensal } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const casaSql = 'INSERT INTO casas (titulo, endereco, descricao, valor_mensal) VALUES ($1, $2, $3, $4) RETURNING id';
        const casaResult = await client.query(casaSql, [titulo, endereco, descricao, valor_mensal]);
        const casaId = casaResult.rows[0].id;
        if (req.files) {
            const imagensSql = 'INSERT INTO imagens_casas (casa_id, caminho_arquivo) VALUES ($1, $2)';
            for (const file of req.files) {
                await client.query(imagensSql, [casaId, file.filename]);
            }
        }
        await client.query('COMMIT');
        res.redirect('/dashboard?success=1');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao adicionar casa:', error);
        res.redirect('/dashboard?error=1');
    } finally {
        client.release();
    }
});

app.get('/alugueis', checarSeAdminLogado, async (req, res) => {
    try {
        const sql = `
            SELECT 
                c.id, c.titulo, c.status, c.valor_mensal,
                a.id AS aluguel_id, a.cliente_id
            FROM casas c
            LEFT JOIN alugueis a ON c.id = a.casa_id AND c.status = 'alugada'
            ORDER BY c.id DESC
        `;
        const result = await pool.query(sql);
        res.render('alugueis', { 
            casas: result.rows,
            success: req.query.success,
            removido: req.query.removido,
            casa_excluida: req.query.casa_excluida,
            error: req.query.error
        });
    } catch (error) {
        console.error('Erro ao buscar casas:', error);
        res.status(500).send("Erro ao carregar a página de gestão de casas.");
    }
});

app.get('/aluguel/:id', checarSeAdminLogado, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM casas WHERE id = $1', [id]);
        if (result.rows.length === 0 || result.rows[0].status === 'alugada') {
            return res.status(404).send("Casa não encontrada ou já alugada.");
        }
        res.render('pagina-aluguel', { casa: result.rows[0] });
    } catch (error) {
        console.error('Erro ao buscar detalhes da casa:', error);
        res.status(500).send("Erro ao carregar a página de aluguel.");
    }
});

app.post('/aluguel/remover', checarSeAdminLogado, async (req, res) => {
    const { aluguel_id, cliente_id, casa_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM alugueis WHERE id = $1', [aluguel_id]);
        await client.query('DELETE FROM clientes WHERE id = $1', [cliente_id]);
        await client.query('UPDATE casas SET status = $1 WHERE id = $2', ['disponivel', casa_id]);
        await client.query('COMMIT');
        res.redirect('/alugueis?removido=1');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao remover aluguel:', error);
        res.status(500).send("Ocorreu um erro ao remover o aluguel.");
    } finally {
        client.release();
    }
});

app.post('/aluguel/:id', checarSeAdminLogado, async (req, res) => {
    const { id: casa_id } = req.params;
    const { nome, rg, telefone, email, data_inicio, data_fim } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const casaResult = await client.query('SELECT valor_mensal FROM casas WHERE id = $1', [casa_id]);
        const valorMensal = casaResult.rows[0].valor_mensal;
        const dataInicio = new Date(data_inicio);
        const dataFim = new Date(data_fim);
        const diffAnos = dataFim.getFullYear() - dataInicio.getFullYear();
        const diffMeses = diffAnos * 12 + (dataFim.getMonth() - dataInicio.getMonth());
        const duracaoMeses = Math.max(1, diffMeses);
        const valorTotal = duracaoMeses * valorMensal;
        const clienteSql = 'INSERT INTO clientes (nome, rg, telefone, email) VALUES ($1, $2, $3, $4) RETURNING id';
        const clienteResult = await client.query(clienteSql, [nome, rg, telefone, email]);
        const clienteId = clienteResult.rows[0].id;
        const aluguelSql = 'INSERT INTO alugueis (casa_id, cliente_id, data_inicio, data_fim, valor_total) VALUES ($1, $2, $3, $4, $5)';
        await client.query(aluguelSql, [casa_id, clienteId, data_inicio, data_fim, valorTotal]);
        await client.query('UPDATE casas SET status = $1 WHERE id = $2', ['alugada', casa_id]);
        await client.query('COMMIT');
        res.redirect('/alugueis?success=Aluguel+registrado+com+sucesso');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao registrar aluguel:', error);
        res.status(500).send("Ocorreu um erro ao registrar o aluguel.");
    } finally {
        client.release();
    }
});

app.post('/casa/excluir/:id', checarSeAdminLogado, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const imagensResult = await client.query('SELECT caminho_arquivo FROM imagens_casas WHERE casa_id = $1', [id]);
        for (const imagem of imagensResult.rows) {
            const caminhoCompleto = path.join(__dirname, 'public/uploads', imagem.caminho_arquivo);
            if (fs.existsSync(caminhoCompleto)) {
                fs.unlinkSync(caminhoCompleto);
            }
        }
        await client.query('DELETE FROM casas WHERE id = $1', [id]);
        await client.query('COMMIT');
        res.redirect('/alugueis?casa_excluida=1');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao excluir casa:', error);
        res.status(500).send("Ocorreu um erro ao excluir a casa.");
    } finally {
        client.release();
    }
});

app.get('/casa/editar/:id', checarSeAdminLogado, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM casas WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Casa não encontrada.');
        }
        res.render('editar-casa', { casa: result.rows[0] });
    } catch (error) {
        console.error('Erro ao buscar dados da casa para edição:', error);
        res.status(500).send('Erro ao carregar página de edição.');
    }
});

app.post('/casa/editar/:id', checarSeAdminLogado, async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, endereco, descricao, valor_mensal } = req.body;
        const sql = `
            UPDATE casas 
            SET titulo = $1, endereco = $2, descricao = $3, valor_mensal = $4 
            WHERE id = $5
        `;
        await pool.query(sql, [titulo, endereco, descricao, valor_mensal, id]);
        res.redirect('/alugueis?success=Casa+atualizada+com+sucesso');
    } catch (error) {
        console.error('Erro ao atualizar casa:', error);
        res.status(500).send('Erro ao salvar as alterações.');
    }
});

app.get('/aluguel/editar/:id', checarSeAdminLogado, async (req, res) => {
    try {
        const { id: aluguel_id } = req.params;
        const sql = `
            SELECT
                a.id AS aluguel_id,
                a.data_inicio,
                a.data_fim,
                a.cliente_id,
                c.id AS casa_id,
                c.titulo AS casa_titulo,
                cl.nome AS cliente_nome,
                cl.rg AS cliente_rg,
                cl.telefone AS cliente_telefone,
                cl.email AS cliente_email
            FROM alugueis a
            JOIN casas c ON a.casa_id = c.id
            JOIN clientes cl ON a.cliente_id = cl.id
            WHERE a.id = $1
        `;
        const result = await pool.query(sql, [aluguel_id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Aluguel não encontrado.');
        }
        res.render('editar-aluguel', { aluguel: result.rows[0] });
    } catch (error) {
        console.error('Erro ao buscar dados do aluguel para edição:', error);
        res.status(500).send('Erro ao carregar página de edição de aluguel.');
    }
});

app.post('/aluguel/editar/:id', checarSeAdminLogado, async (req, res) => {
    const { id: aluguel_id } = req.params;
    const { nome, rg, telefone, email, data_inicio, data_fim, cliente_id, casa_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const clienteSql = 'UPDATE clientes SET nome = $1, rg = $2, telefone = $3, email = $4 WHERE id = $5';
        await client.query(clienteSql, [nome, rg, telefone, email, cliente_id]);

        const casaResult = await client.query('SELECT valor_mensal FROM casas WHERE id = $1', [casa_id]);
        const valorMensal = casaResult.rows[0].valor_mensal;

        const dataInicio = new Date(data_inicio);
        const dataFim = new Date(data_fim);
        const diffAnos = dataFim.getFullYear() - dataInicio.getFullYear();
        const diffMeses = diffAnos * 12 + (dataFim.getMonth() - dataInicio.getMonth());
        const duracaoMeses = Math.max(1, diffMeses);
        const valorTotal = duracaoMeses * valorMensal;

        const aluguelSql = 'UPDATE alugueis SET data_inicio = $1, data_fim = $2, valor_total = $3 WHERE id = $4';
        await client.query(aluguelSql, [data_inicio, data_fim, valorTotal, aluguel_id]);

        await client.query('COMMIT');
        res.redirect('/alugueis?success=Aluguel+atualizado+com+sucesso');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao atualizar aluguel:', error);
        res.status(500).send("Ocorreu um erro ao atualizar o aluguel.");
    } finally {
        client.release();
    }
});

app.get('/relatorio-alugueis', checarSeAdminLogado, async (req, res) => {
    try {
        const sql = `
            SELECT 
                c.titulo AS casa_titulo,
                cl.nome AS cliente_nome,
                cl.email AS cliente_email,
                cl.telefone AS cliente_telefone,
                a.data_inicio,
                a.data_fim,
                a.valor_total
            FROM alugueis a
            JOIN casas c ON a.casa_id = c.id
            JOIN clientes cl ON a.cliente_id = cl.id
            ORDER BY a.data_inicio DESC
        `;
        const result = await pool.query(sql);
        res.render('relatorio', { alugueis: result.rows });
    } catch (error) {
        console.error('Erro ao buscar relatório de alugueis:', error);
        res.status(500).send("Erro ao carregar o relatório.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login.html');
    });
});

app.listen(port, () => {
    console.log(`Servidor Apêgo a ser executado em http://localhost:${port}`);
});