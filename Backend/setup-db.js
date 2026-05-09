
const mysql = require('mysql2/promise');

require("dotenv").config();

async function setup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
  });

  const db = process.env.DB_NAME || 'crm_db';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${db}\``);
  await connection.query(`USE \`${db}\``);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      username    VARCHAR(100) NOT NULL UNIQUE,
      password    VARCHAR(255) NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(200) NOT NULL,
      email       VARCHAR(200) NOT NULL,
      phone       VARCHAR(50),
      company     VARCHAR(200),
      source      VARCHAR(100) DEFAULT 'Website',
      status      ENUM('new','contacted','converted','lost') DEFAULT 'new',
      priority    ENUM('low','medium','high') DEFAULT 'medium',
      message     TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      lead_id     INT NOT NULL,
      admin_id    INT,
      content     TEXT NOT NULL,
      follow_up   DATE,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
    )
  `);

  
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('Admin@1234', 12);
  await connection.query(
    `INSERT IGNORE INTO admins (username, password) VALUES (?, ?)`,
    ['admin', hash]
  );

  const leads = [
    ['Priya Sharma','priya@techcorp.in','9876543210','TechCorp','LinkedIn','new','high','Looking for ERP solution'],
    ['Arjun Mehta','arjun@startups.io','9123456780','StartupIO','Website','contacted','medium','Interested in SaaS plan'],
    ['Neha Gupta','neha@design.co','','DesignCo','Referral','converted','low','Signed up for Pro tier'],
  ];
  for (const l of leads) {
    await connection.query(
      `INSERT IGNORE INTO leads (name,email,phone,company,source,status,priority,message) VALUES (?,?,?,?,?,?,?,?)`,
      l
    );
  }

  console.log('✅  Database setup complete!');
  console.log('   Default login → username: admin  |  password: Admin@1234');
  await connection.end();
}

setup().catch(err => { console.error(err); process.exit(1); });
