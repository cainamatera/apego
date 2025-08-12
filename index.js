require('dotenv').config();

const express = require('express');
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

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
        const result = await pool.query('SELECT * FROM administradores WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(401).send('Email ou senha incorretos.');
        }

        const admin = result.rows[0];
        const senhaValida = await bcrypt.compare(senha, admin.senha_hash);

        if (!senhaValida) {
            return res.status(401).send('Email ou senha incorretos.');
        }

        res.send('Login bem-sucedido! Bem-vindo, administrador.');

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).send('Ocorreu um erro no servidor.');
    }
});

app.listen(port, () => {
    console.log(`Servidor Apêgo a ser executado em http://localhost:${port}`);
});