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

app.get('/dashboard', checarSeAdminLogado, (req, res) => {
    res.sendFile(path.join(__dirname, '/public/dashboard.html'));
});

app.post('/casas', checarSeAdminLogado, upload.array('imagens', 10), async (req, res) => {
    const { titulo, endereco, descricao, valor_diaria } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const casaSql = 'INSERT INTO casas (titulo, endereco, descricao, valor_diaria) VALUES ($1, $2, $3, $4) RETURNING id';
        const casaResult = await client.query(casaSql, [titulo, endereco, descricao, valor_diaria]);
        const casaId = casaResult.rows[0].id;

        const imagensSql = 'INSERT INTO imagens_casas (casa_id, caminho_arquivo) VALUES ($1, $2)';
        for (const file of req.files) {
            await client.query(imagensSql, [casaId, file.filename]);
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