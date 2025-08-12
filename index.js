require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
const port = 3000;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'uma-chave-muito-secreta-e-dificil-de-adivinhar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

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

app.get('/dashboard', (req, res) => {
    if (req.session.adminId) {
        res.sendFile(path.join(__dirname, '/public/dashboard.html'));
    } else {
        res.redirect('/login.html');
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