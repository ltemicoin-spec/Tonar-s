require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is missing.");
    process.exit(1);
}

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


/* ================================
   TEMPORARY DATABASE
   ================================

   Şimdilik kullanıcıları RAM'de tutuyoruz.
   Daha sonra PostgreSQL/Supabase bağlayacağız.

================================ */

const users = new Map();


/* ================================
   TASKS
================================ */

const tasks = {

    join_channel: {
        reward: 10000
    },

    follow_x: {
        reward: 10000
    },

    partner: {
        reward: 25000
    }

};


/* ================================
   TELEGRAM INIT DATA VALIDATION
================================ */

function validateTelegramInitData(initData) {

    if (!initData) {
        throw new Error(
            "Telegram authentication required."
        );
    }

    const params =
        new URLSearchParams(initData);

    const hash =
        params.get("hash");

    if (!hash) {
        throw new Error(
            "Invalid Telegram init data."
        );
    }

    params.delete("hash");

    const dataCheckString =
        [...params.entries()]
            .sort(
                ([a], [b]) =>
                    a.localeCompare(b)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(BOT_TOKEN)
            .digest();


    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


    if (
        calculatedHash.length !==
        hash.length
    ) {
        throw new Error(
            "Invalid Telegram signature."
        );
    }


    if (
        !crypto.timingSafeEqual(
            Buffer.from(calculatedHash),
            Buffer.from(hash)
        )
    ) {
        throw new Error(
            "Invalid Telegram signature."
        );
    }


    /* Session expiration check */

    const authDate =
        Number(
            params.get("auth_date")
        );

    const now =
        Math.floor(
            Date.now() / 1000
        );


    if (
        !authDate ||
        now - authDate > 86400
    ) {
        throw new Error(
            "Telegram session expired."
        );
    }


    const userJSON =
        params.get("user");


    if (!userJSON) {
        throw new Error(
            "Telegram user not found."
        );
    }


    return JSON.parse(userJSON);
}


/* ================================
   TELEGRAM AUTH MIDDLEWARE
================================ */

function telegramAuth(
    req,
    res,
    next
) {

    try {

        const initData =
            req.headers[
                "x-telegram-init-data"
            ];


        const telegramUser =
            validateTelegramInitData(
                initData
            );


        req.telegramUser =
            telegramUser;


        next();

    } catch (error) {

        res.status(401).json({
            error: error.message
        });

    }

}


/* ================================
   ENERGY REGENERATION
================================ */

function regenerateEnergy(user) {

    const now =
        Date.now();

    const elapsed =
        now -
        user.lastEnergyUpdate;

    const seconds =
        Math.floor(
            elapsed / 1000
        );


    if (seconds <= 0) {
        return;
    }


    /*
       4 energy / second
    */

    user.energy =
        Math.min(
            user.maxEnergy,
            user.energy +
            seconds * 4
        );


    user.lastEnergyUpdate =
        now;

}


/* ================================
   GET CURRENT USER
================================ */

app.get(
    "/api/me",
    telegramAuth,
    (req, res) => {

        const telegramUser =
            req.telegramUser;


        const id =
            String(
                telegramUser.id
            );


        let user =
            users.get(id);


        /* Create new user */

        if (!user) {

            user = {

                id: id,

                username:
                    telegramUser.username ||
                    telegramUser.first_name ||
                    "Player",

                balance: 0,

                energy: 1000,

                maxEnergy: 1000,

                lastEnergyUpdate:
                    Date.now(),

                completedTasks:
                    new Set(),

                wallet: null

            };


            users.set(
                id,
                user
            );

        }


        regenerateEnergy(user);


        res.json({

            id:
                user.id,

            username:
                user.username,

            balance:
                user.balance,

            energy:
                user.energy,

            maxEnergy:
                user.maxEnergy,

            wallet:
                user.wallet

        });

    }
);


/* ================================
   TAP
================================ */

app.post(
    "/api/tap",
    telegramAuth,
    (req, res) => {

        const id =
            String(
                req.telegramUser.id
            );


        const user =
            users.get(id);


        if (!user) {

            return res.status(404)
                .json({
                    error:
                        "User not found."
                });

        }


        regenerateEnergy(user);


        if (user.energy <= 0) {

            return res.status(400)
                .json({
                    error:
                        "No energy."
                });

        }


        user.energy -= 1;

        user.balance += 1;


        res.json({

            success: true,

            balance:
                user.balance,

            energy:
                user.energy,

            maxEnergy:
                user.maxEnergy

        });

    }
);


/* ================================
   GET TASKS
================================ */

app.get(
    "/api/tasks",
    telegramAuth,
    (req, res) => {

        const id =
            String(
                req.telegramUser.id
            );


        const user =
            users.get(id);


        if (!user) {

            return res.status(404)
                .json({
                    error:
                        "User not found."
                });

        }


        const result =
            Object.entries(tasks)
                .map(
                    ([id, task]) => ({

                        id: id,

                        reward:
                            task.reward,

                        completed:
                            user.completedTasks
                                .has(id)

                    })
                );


        res.json({

            tasks:
                result

        });

    }
);


/* ================================
   CLAIM TASK
================================ */

app.post(
    "/api/tasks/claim",
    telegramAuth,
    (req, res) => {

        const id =
            String(
                req.telegramUser.id
            );


        const user =
            users.get(id);


        if (!user) {

            return res.status(404)
                .json({
                    error:
                        "User not found."
                });

        }


        const taskId =
            req.body.taskId;


        const task =
            tasks[taskId];


        if (!task) {

            return res.status(400)
                .json({
                    error:
                        "Invalid task."
                });

        }


        /*
           Prevent double claiming.
        */

        if (
            user.completedTasks
                .has(taskId)
        ) {

            return res.status(400)
                .json({
                    error:
                        "Task already claimed."
                });

        }


        /*
           Reward user.
        */

        user.balance +=
            task.reward;


        user.completedTasks
            .add(taskId);


        res.json({

            success: true,

            user: {

                id:
                    user.id,

                username:
                    user.username,

                balance:
                    user.balance,

                energy:
                    user.energy,

                maxEnergy:
                    user.maxEnergy

            }

        });

    }
);


/* ================================
   LEADERBOARD
================================ */

app.get(
    "/api/leaderboard",
    telegramAuth,
    (req, res) => {

        const leaderboard =

            [...users.values()]

                .sort(
                    (a, b) =>
                        b.balance -
                        a.balance
                )

                .slice(0, 50)

                .map(
                    user => ({

                        name:
                            user.username,

                        balance:
                            user.balance

                    })
                );


        res.json({

            leaderboard:
                leaderboard

        });

    }
);


/* ================================
   HEALTH CHECK
================================ */

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            status:
                "online",

            project:
                "TONARIS",

            token:
                "TNR"

        });

    }
);


/* ================================
   START SERVER
================================ */

app.listen(
    PORT,
    () => {

        console.log(
            `TONARIS server running on port ${PORT}`
        );

    }
);
