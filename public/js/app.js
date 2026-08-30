let deliveries = [];
let riders = [];

const api = "/api";

async function loadData() {
    try {
        const deliveriesResponse =
            await fetch(`${api}/deliveries`);

        deliveries = await deliveriesResponse.json();

        const ridersResponse =
            await fetch(`${api}/riders`);

        riders = await ridersResponse.json();

        renderEverything();
    } catch (error) {
        console.error("Failed to load data:", error);
    }
}

function showView(viewName) {
    stopScanner();

    document.querySelectorAll(".view")
        .forEach(view => {
            view.classList.add("hidden");
        });

    document
        .getElementById(viewName)
        .classList.remove("hidden");
}


/* =========================
   CREATE DELIVERY
========================= */

document
    .getElementById("deliveryForm")
    .addEventListener("submit", async function(event) {

        event.preventDefault();

        const payload = {
            customer_name:
                document.getElementById("customerName").value,

            customer_phone:
                document.getElementById("customerPhone").value,

            address:
                document.getElementById("address").value,

            item_description:
                document.getElementById("itemDescription").value,

            retailer_id: 1
        };

        try {
            const response = await fetch(
                `${api}/deliveries`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                }
            );

            const data = await response.json();

            if (!response.ok) {
                alert(data.error || "Could not create delivery.");
                return;
            }

            alert(
                `Delivery created: ${data.order_number}`
            );

            this.reset();

            await loadData();

        } catch (error) {
            console.error(error);
            alert("Unable to connect to the server.");
        }
    });


/* =========================
   ASSIGN RIDER
========================= */

async function assignRider(deliveryId) {

    const riderId =
        document.getElementById(
            `rider-${deliveryId}`
        ).value;

    if (!riderId) {
        alert("Select a rider.");
        return;
    }

    await fetch(
        `${api}/deliveries/${deliveryId}/assign`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                rider_id: Number(riderId),
                changed_by: 2
            })
        }
    );

    await loadData();
}


/* =========================
   UPDATE DELIVERY STATUS
========================= */

async function updateStatus(deliveryId, status) {

    const response = await fetch(
        `${api}/deliveries/${deliveryId}/status`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                status,
                changed_by: 3
            })
        }
    );

    if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Unable to update status.");
        return;
    }

    await loadData();
}


/* =========================
   RENDER EVERYTHING
========================= */

function renderEverything() {

    renderRetailer();

    renderDispatcher();

    renderRider();

    updateStats();

    populateRiders();
}


/* =========================
   RETAILER
========================= */

function renderRetailer() {

    const container =
        document.getElementById(
            "retailerDeliveries"
        );

    container.innerHTML =
        "<h3>Recent Deliveries</h3>";

    deliveries.forEach(delivery => {

        container.innerHTML += `
            <div class="delivery">

                <h3>
                    ${delivery.order_number}
                </h3>

                <p>
                    <strong>
                        ${delivery.customer_name}
                    </strong>
                </p>

                <p>
                    ${delivery.address}
                </p>

                <p>
                    ${delivery.item_description}
                </p>

                <span class="status">
                    ${delivery.status}
                </span>

                ${
                    delivery.rider_name
                        ? `<p>Rider: ${delivery.rider_name}</p>`
                        : ""
                }

                ${
                    delivery.status !== "DELIVERED"
                    ? `
                        <div class="customer-qr">

                            <h4>Customer Delivery QR</h4>

                            <div
                                id="qr-${delivery.id}"
                                class="qr-code"
                            ></div>

                            <p>
                                <small>
                                    Show this QR code to the rider
                                    when your delivery arrives.
                                </small>
                            </p>

                        </div>
                    `
                    : `
                        <p class="delivery-confirmed">
                            ✓ Delivery confirmed
                        </p>
                    `
                }

            </div>
        `;
    });

    generateCustomerQRCodes();
}


/* =========================
   GENERATE CUSTOMER QR CODES
========================= */

function generateCustomerQRCodes() {

    if (typeof QRCode === "undefined") {
        console.error("QRCode library is not loaded.");
        return;
    }

    deliveries.forEach(delivery => {

        if (
            delivery.status === "DELIVERED" ||
            !delivery.confirmation_code
        ) {
            return;
        }

        const element =
            document.getElementById(
                `qr-${delivery.id}`
            );

        if (!element) {
            return;
        }

        element.innerHTML = "";

        const qrPayload = JSON.stringify({
            deliveryId: delivery.id,
            code: delivery.confirmation_code
        });

        new QRCode(element, {
            text: qrPayload,
            width: 180,
            height: 180
        });
    });
}


/* =========================
   DISPATCHER
========================= */

function renderDispatcher() {

    const container =
        document.getElementById(
            "dispatcherDeliveries"
        );

    container.innerHTML = "";

    deliveries.forEach(delivery => {

        const riderOptions = riders
            .map(rider => `
                <option value="${rider.id}">
                    ${rider.name}
                </option>
            `)
            .join("");

        container.innerHTML += `
            <div class="delivery">

                <h3>
                    ${delivery.order_number}
                </h3>

                <p>
                    Customer:
                    ${delivery.customer_name}
                </p>

                <p>
                    Phone:
                    ${delivery.customer_phone}
                </p>

                <p>
                    Address:
                    ${delivery.address}
                </p>

                <p>
                    Item:
                    ${delivery.item_description}
                </p>

                <p>
                    Status:
                    <span class="status">
                        ${delivery.status}
                    </span>
                </p>

                <p>
                    Rider:
                    ${delivery.rider_name || "Not assigned"}
                </p>

                ${
                    delivery.status === "OPEN"
                    ? `
                        <div class="actions">

                            <select id="rider-${delivery.id}">
                                <option value="">
                                    Select rider
                                </option>

                                ${riderOptions}
                            </select>

                            <button
                                onclick="assignRider(${delivery.id})"
                            >
                                Assign Rider
                            </button>

                        </div>
                    `
                    : ""
                }

            </div>
        `;
    });
}


/* =========================
   RIDER
========================= */

function renderRider() {

    const selectedRider =
        Number(
            document.getElementById(
                "riderSelector"
            ).value
        ) || 3;

    const container =
        document.getElementById(
            "riderDeliveries"
        );

    const assigned =
        deliveries.filter(
            delivery =>
                delivery.rider_id === selectedRider
        );

    container.innerHTML = "";

    assigned.forEach(delivery => {

        container.innerHTML += `
            <div class="delivery">

                <h3>
                    ${delivery.order_number}
                </h3>

                <p>
                    Customer:
                    ${delivery.customer_name}
                </p>

                <p>
                    Phone:
                    ${delivery.customer_phone}
                </p>

                <p>
                    Address:
                    ${delivery.address}
                </p>

                <p>
                    Item:
                    ${delivery.item_description}
                </p>

                <p>
                    Status:
                    <span class="status">
                        ${delivery.status}
                    </span>
                </p>

                <div class="actions">

                    ${
                        delivery.status === "ASSIGNED"
                        ? `
                            <button
                                onclick="updateStatus(
                                    ${delivery.id},
                                    'PICKED_UP'
                                )"
                            >
                                Picked Up
                            </button>
                        `
                        : ""
                    }

                    <button
                        onclick="openScanner()"
                    >
                        📷 Scan Customer QR
                    </button>

                </div>

            </div>
        `;
    });
}


/* =========================
   RIDER SELECTOR
========================= */

function populateRiders() {

    const selector =
        document.getElementById(
            "riderSelector"
        );

    const currentValue =
        selector.value;

    selector.innerHTML = riders
        .map(rider => `
            <option value="${rider.id}">
                ${rider.name}
            </option>
        `)
        .join("");

    selector.value =
        currentValue || riders[0]?.id || "";

    selector.onchange =
        renderRider;
}


/* =========================
   STATS
========================= */

function updateStats() {

    document.getElementById("openCount")
        .textContent =
        deliveries.filter(
            d => d.status === "OPEN"
        ).length;

    document.getElementById("assignedCount")
        .textContent =
        deliveries.filter(
            d => d.status === "ASSIGNED"
        ).length;

    document.getElementById("pickupCount")
        .textContent =
        deliveries.filter(
            d => d.status === "PICKED_UP"
        ).length;

    document.getElementById("deliveredCount")
        .textContent =
        deliveries.filter(
            d => d.status === "DELIVERED"
        ).length;
}


/* =========================
   QR SCANNER
========================= */

let qrScanner = null;
let scannerProcessing = false;


function openScanner() {

    showView("confirmation");

    document.getElementById(
        "confirmationCode"
    ).value = "";

    document.getElementById(
        "confirmationOrder"
    ).value = "";

    document.getElementById(
        "confirmationResult"
    ).textContent =
        "Point the camera at the customer's QR code.";

    scannerProcessing = false;

    startScanner();
}


function startScanner() {

    stopScanner();

    const scannerElement =
        document.getElementById("qr-reader");

    if (!scannerElement) {
        return;
    }

    scannerElement.innerHTML = "";

    qrScanner =
        new Html5Qrcode("qr-reader");

    qrScanner.start(
        {
            facingMode: "environment"
        },
        {
            fps: 10,
            qrbox: {
                width: 250,
                height: 250
            }
        },
        qrCodeMessage => {

            if (scannerProcessing) {
                return;
            }

            scannerProcessing = true;

            processScannedQRCode(qrCodeMessage);

        },
        errorMessage => {
            // Normal scanning errors are ignored.
        }
    ).catch(error => {

        document.getElementById(
            "confirmationResult"
        ).textContent =
            "Camera could not be started. Enter the code manually.";

        console.error(error);
    });
}


function stopScanner() {

    if (qrScanner) {

        qrScanner.stop()
            .then(() => {
                qrScanner.clear();
            })
            .catch(() => {});

        qrScanner = null;
    }
}


/* =========================
   PROCESS QR
========================= */

function processScannedQRCode(qrCodeMessage) {

    let payload;

    try {

        payload =
            JSON.parse(qrCodeMessage);

    } catch (error) {

        // Support old/simple QR codes
        document.getElementById(
            "confirmationCode"
        ).value = qrCodeMessage;

        document.getElementById(
            "confirmationResult"
        ).textContent =
            "QR scanned. A delivery must be selected.";

        stopScanner();

        scannerProcessing = false;

        return;
    }

    if (
        !payload.deliveryId ||
        !payload.code
    ) {

        document.getElementById(
            "confirmationResult"
        ).textContent =
            "Invalid Reflex delivery QR code.";

        scannerProcessing = false;

        return;
    }

    document.getElementById(
        "confirmationOrder"
    ).value =
        payload.deliveryId;

    document.getElementById(
        "confirmationCode"
    ).value =
        payload.code;

    document.getElementById(
        "confirmationResult"
    ).textContent =
        "QR recognised. Confirming delivery...";

    stopScanner();

    confirmDelivery();
}


/* =========================
   CONFIRM DELIVERY
========================= */

async function confirmDelivery() {

    const id =
        document.getElementById(
            "confirmationOrder"
        ).value;

    const code =
        document.getElementById(
            "confirmationCode"
        ).value
        .trim();

    const result =
        document.getElementById(
            "confirmationResult"
        );

    if (!id) {

        result.textContent =
            "No delivery selected.";

        return;
    }

    if (!code) {

        result.textContent =
            "Enter or scan a confirmation code.";

        return;
    }

    try {

        const response = await fetch(
            `${api}/deliveries/${id}/confirm`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    code,
                    changed_by: 3
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok) {

            result.textContent =
                data.error ||
                "Delivery confirmation failed.";

            scannerProcessing = false;

            return;
        }

        result.textContent =
            `✓ ${data.order_number} successfully delivered.`;

        scannerProcessing = false;

        await loadData();

    } catch (error) {

        console.error(error);

        result.textContent =
            "Unable to connect to the server.";

        scannerProcessing = false;
    }
}


/* =========================
   REAL-TIME CONNECTION
========================= */

function connectRealtime() {

    const events =
        new EventSource(
            `${api}/events`
        );

    events.onopen = () => {

        document.getElementById(
            "connection"
        ).textContent =
            "● Live";
    };

    events.onmessage = async event => {

        console.log(
            "Realtime event:",
            event.data
        );

        await loadData();
    };

    events.onerror = () => {

        document.getElementById(
            "connection"
        ).textContent =
            "● Reconnecting...";
    };
}


/* =========================
   START APPLICATION
========================= */

loadData();

connectRealtime();