const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Create database directory if it doesn't exist
const dataDirectory = path.join(__dirname, "data");

if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(
    path.join(dataDirectory, "reflex.db")
);

db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK(role IN ('RETAILER', 'DISPATCHER', 'RIDER'))
);

CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    address TEXT NOT NULL,
    item_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    retailer_id INTEGER,
    rider_id INTEGER,
    confirmation_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(retailer_id) REFERENCES users(id),
    FOREIGN KEY(rider_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS delivery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    changed_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(delivery_id) REFERENCES deliveries(id),
    FOREIGN KEY(changed_by) REFERENCES users(id)
);
`);

// Seed demo users
const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

if (userCount === 0) {
    const insert = db.prepare(
        "INSERT INTO users (name, phone, role) VALUES (?, ?, ?)"
    );

    insert.run("Jane Retailer", "0712345678", "RETAILER");
    insert.run("Peter Dispatcher", "0722345678", "DISPATCHER");
    insert.run("John Rider", "0732345678", "RIDER");
    insert.run("Mary Rider", "0742345678", "RIDER");
}

// Server-Sent Events clients
const clients = [];

function broadcast(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;

    clients.forEach((client) => {
        client.res.write(message);
    });
}

function generateOrderNumber() {
    return "RF-" + Date.now().toString().slice(-8);
}

function generateConfirmationCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        service: "Reflex",
        time: new Date().toISOString()
    });
});

// Users
app.get("/api/users", (req, res) => {
    const users = db.prepare(`
        SELECT id, name, phone, role
        FROM users
        ORDER BY name
    `).all();

    res.json(users);
});

// Riders
app.get("/api/riders", (req, res) => {
    const riders = db.prepare(`
        SELECT id, name, phone
        FROM users
        WHERE role = 'RIDER'
        ORDER BY name
    `).all();

    res.json(riders);
});

// Create delivery
app.post("/api/deliveries", (req, res) => {
    const {
        customer_name,
        customer_phone,
        address,
        item_description,
        retailer_id
    } = req.body;

    if (
        !customer_name ||
        !customer_phone ||
        !address ||
        !item_description
    ) {
        return res.status(400).json({
            error: "All delivery fields are required."
        });
    }

    const orderNumber = generateOrderNumber();
    const confirmationCode = generateConfirmationCode();

    const result = db.prepare(`
        INSERT INTO deliveries (
            order_number,
            customer_name,
            customer_phone,
            address,
            item_description,
            status,
            retailer_id,
            confirmation_code
        )
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)
    `).run(
        orderNumber,
        customer_name,
        customer_phone,
        address,
        item_description,
        retailer_id || null,
        confirmationCode
    );

    const deliveryId = result.lastInsertRowid;

    db.prepare(`
        INSERT INTO delivery_events
        (delivery_id, status, changed_by)
        VALUES (?, 'OPEN', ?)
    `).run(deliveryId, retailer_id || null);

    const delivery = db.prepare(`
        SELECT *
        FROM deliveries
        WHERE id = ?
    `).get(deliveryId);

    broadcast({
        type: "DELIVERY_CREATED",
        delivery
    });

    res.status(201).json(delivery);
});

// Get deliveries
app.get("/api/deliveries", (req, res) => {
    const deliveries = db.prepare(`
        SELECT
            d.*,
            r.name AS rider_name,
            rt.name AS retailer_name
        FROM deliveries d
        LEFT JOIN users r ON d.rider_id = r.id
        LEFT JOIN users rt ON d.retailer_id = rt.id
        ORDER BY d.created_at DESC
    `).all();

    res.json(deliveries);
});

// Assign rider
app.patch("/api/deliveries/:id/assign", (req, res) => {
    const deliveryId = req.params.id;
    const { rider_id, changed_by } = req.body;

    if (!rider_id) {
        return res.status(400).json({
            error: "Rider is required."
        });
    }

    const rider = db.prepare(`
        SELECT id
        FROM users
        WHERE id = ? AND role = 'RIDER'
    `).get(rider_id);

    if (!rider) {
        return res.status(400).json({
            error: "Invalid rider."
        });
    }

    db.prepare(`
        UPDATE deliveries
        SET rider_id = ?,
            status = 'ASSIGNED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(rider_id, deliveryId);

    db.prepare(`
        INSERT INTO delivery_events
        (delivery_id, status, changed_by)
        VALUES (?, 'ASSIGNED', ?)
    `).run(deliveryId, changed_by || null);

    const delivery = db.prepare(`
        SELECT
            d.*,
            r.name AS rider_name
        FROM deliveries d
        LEFT JOIN users r ON d.rider_id = r.id
        WHERE d.id = ?
    `).get(deliveryId);

    broadcast({
        type: "DELIVERY_UPDATED",
        delivery
    });

    res.json(delivery);
});

// Rider changes status
app.patch("/api/deliveries/:id/status", (req, res) => {
    const deliveryId = req.params.id;
    const { status, changed_by } = req.body;

    const allowedStatuses = [
        "ASSIGNED",
        "PICKED_UP",
        "DELIVERED"
    ];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            error: "Invalid status."
        });
    }

    const delivery = db.prepare(`
        SELECT *
        FROM deliveries
        WHERE id = ?
    `).get(deliveryId);

    if (!delivery) {
        return res.status(404).json({
            error: "Delivery not found."
        });
    }

    db.prepare(`
        UPDATE deliveries
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, deliveryId);

    db.prepare(`
        INSERT INTO delivery_events
        (delivery_id, status, changed_by)
        VALUES (?, ?, ?)
    `).run(deliveryId, status, changed_by || null);

    const updated = db.prepare(`
        SELECT
            d.*,
            r.name AS rider_name,
            rt.name AS retailer_name
        FROM deliveries d
        LEFT JOIN users r ON d.rider_id = r.id
        LEFT JOIN users rt ON d.retailer_id = rt.id
        WHERE d.id = ?
    `).get(deliveryId);

    broadcast({
        type: "DELIVERY_UPDATED",
        delivery: updated
    });

    res.json(updated);
});

// Confirm order using code
app.post("/api/deliveries/:id/confirm", (req, res) => {
    const deliveryId = req.params.id;
    const { code, changed_by } = req.body;

    const delivery = db.prepare(`
        SELECT *
        FROM deliveries
        WHERE id = ?
    `).get(deliveryId);

    if (!delivery) {
        return res.status(404).json({
            error: "Delivery not found."
        });
    }

    if (String(code).toUpperCase() !== String(delivery.confirmation_code).toUpperCase()) {
        return res.status(400).json({
            error: "Invalid confirmation code."
        });
    }

    db.prepare(`
        UPDATE deliveries
        SET status = 'DELIVERED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(deliveryId);

    db.prepare(`
        INSERT INTO delivery_events
        (delivery_id, status, changed_by)
        VALUES (?, 'DELIVERED', ?)
    `).run(deliveryId, changed_by || null);

    const updated = db.prepare(`
        SELECT
            d.*,
            r.name AS rider_name,
            rt.name AS retailer_name
        FROM deliveries d
        LEFT JOIN users r ON d.rider_id = r.id
        LEFT JOIN users rt ON d.retailer_id = rt.id
        WHERE d.id = ?
    `).get(deliveryId);

    broadcast({
        type: "DELIVERY_CONFIRMED",
        delivery: updated
    });

    res.json(updated);
});

// Delivery history
app.get("/api/deliveries/:id/events", (req, res) => {
    const events = db.prepare(`
        SELECT
            e.*,
            u.name AS changed_by_name
        FROM delivery_events e
        LEFT JOIN users u ON e.changed_by = u.id
        WHERE e.delivery_id = ?
        ORDER BY e.created_at ASC
    `).all(req.params.id);

    res.json(events);
});

// Real-time synchronization
app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.flushHeaders();

    const client = { res };

    clients.push(client);

    res.write(`data: ${JSON.stringify({
        type: "CONNECTED"
    })}\n\n`);

    req.on("close", () => {
        const index = clients.indexOf(client);

        if (index !== -1) {
            clients.splice(index, 1);
        }
    });
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`Reflex running at http://localhost:${PORT}`);
});