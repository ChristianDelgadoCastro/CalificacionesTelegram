const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const sql = require('mssql');

// Configurar la conexión a la base de datos (reemplaza con tus propios datos)
const dbConfig = {
    user: 'usersql',
    password: 'root2',
    server: 'localhost',
    database: 'dbo',
    options: {
        encrypt: false,
    },
};

// Crear una instancia del bot de Telegram con tu token de acceso
const botToken = '6632327311:AAHMk4ih-z86hArQXi7GeSZXfEkdSTOQ-2E'; // <-- Reemplaza con el token de acceso de tu bot
const bot = new TelegramBot(botToken, { polling: true });

// Inicializar el servidor Express
const app = express();
app.use(bodyParser.json());

// Ruta para recibir actualizaciones de Telegram
app.post(`/bot${botToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Escuchar el comando /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = '¡Hola! Bienvenido a CalificacionesBot. ¿Qué deseas consultar?';
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '1. Calificaciones', callback_data: '1' },
                    { text: '2. Promedio General', callback_data: '2' }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, welcomeMessage, options);
});

// Función para calcular el promedio general del estudiante
async function calcularPromedioGeneral(numeroControl) {
    try {
        await sql.connect(dbConfig);

        // Consultar las calificaciones del estudiante desde la tabla dbo.calificaciones
        const calificacionesQuery = `SELECT calificacion FROM calificaciones WHERE nControl = '${numeroControl}' AND nControlAsignatura IS NOT NULL`;
        const calificacionesResult = await sql.query(calificacionesQuery);

        // Verificar si se encontraron calificaciones para el estudiante
        if (calificacionesResult.recordset.length === 0) {
            throw new Error('No se encontraron calificaciones para el número de control proporcionado.');
        }

        // Calcular el promedio general
        let totalCalificaciones = 0;
        let cantidadCalificaciones = 0;
        for (const calificacion of calificacionesResult.recordset) {
            totalCalificaciones += calificacion.calificacion;
            cantidadCalificaciones++;
        }

        const promedio = totalCalificaciones / cantidadCalificaciones;
        return promedio.toFixed(2);
    } catch (error) {
        console.error('Error al calcular el promedio general:', error);
        throw error;
    } finally {
        sql.close();
    }
}

// Función para realizar la consulta a la base de datos y obtener el nombre del estudiante y sus calificaciones
async function consultarCalificaciones(numeroControl) {
    try {
        await sql.connect(dbConfig);

        // Consultar el nombre del estudiante desde la tabla dbo.alumnos
        const alumnosQuery = `SELECT nombre FROM dbo.alumnos WHERE nControl = '${numeroControl}'`;
        const alumnosResult = await sql.query(alumnosQuery);

        // Verificar si se encontró el estudiante en la tabla
        if (alumnosResult.recordset.length === 0) {
            throw new Error('Estudiante no encontrado en la base de datos.');
        }

        const studentName = alumnosResult.recordset[0].nombre;

        // Consultar las calificaciones desde la tabla dbo.calificaciones
        const calificacionesQuery = `SELECT nControlAsignatura, calificacion FROM calificaciones WHERE nControl = '${numeroControl}'`;
        const calificacionesResult = await sql.query(calificacionesQuery);

        // Obtener el nombre de la asignatura para cada calificación
        const filteredCalificaciones = calificacionesResult.recordset.filter((calificacion) => calificacion.nControlAsignatura !== null);
        for (const calificacion of filteredCalificaciones) {
            const asignaturaQuery = `SELECT asignatura FROM asignaturas WHERE nControlAsignatura = '${calificacion.nControlAsignatura}'`;
            const asignaturaResult = await sql.query(asignaturaQuery);

            if (asignaturaResult.recordset.length > 0) {
                calificacion.asignatura = asignaturaResult.recordset[0].asignatura;
            } else {
                calificacion.asignatura = 'Asignatura no encontrada'; // Mensaje para asignatura no encontrada
            }
        }

        return {
            studentName: studentName,
            calificaciones: filteredCalificaciones
        };
    } catch (error) {
        console.error('Error al consultar la base de datos:', error);
        throw error; // Enviar el error al cliente
    } finally {
        sql.close();
    }
}

// Función para dar formato a las calificaciones como tabla
function formatCalificaciones(calificaciones, isPromedio = false) {
    if (isPromedio) {
        return `El promedio general de *${calificaciones.studentName}* es: *${calificaciones.calificacion}*\n`;
    } else {
        let message = `Calificaciones de *${calificaciones.studentName}*:\n`; // Nombre del alumno en negrita

        // Filas de la tabla
        calificaciones.calificaciones.forEach((calificacion) => {
            message += `${calificacion.asignatura}: *${calificacion.calificacion}*\n`;
        });

        return message;
    }
}

// Variable para almacenar el contexto del usuario
const userContext = {};

// Escuchar opción "1" - Consultar Calificaciones
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const option = query.data;

    if (option === '1') {
        // Establecer el contexto del usuario para consultar calificaciones
        userContext[chatId] = { option: '1' };

        // Pedir el número de control al usuario
        bot.sendMessage(chatId, 'Por favor, ingresa el número de control para consultar las calificaciones:');
    } else if (option === '2') {
        // Establecer el contexto del usuario para calcular el promedio general
        userContext[chatId] = { option: '2' };

        // Pedir el número de control al usuario
        bot.sendMessage(chatId, 'Por favor, ingresa el número de control para calcular el promedio general:');
    }
});

// Escuchar el número de control ingresado
bot.onText(/\d{6,8}/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userMessage = match[0];

    try {
        if (userContext[chatId]?.option === '1') {
            // Consultar la base de datos
            const calificaciones = await consultarCalificaciones(userMessage);
            if (calificaciones.calificaciones.length === 0) {
                bot.sendMessage(chatId, 'No se encontraron calificaciones para el número de control proporcionado.');
            } else {
                // Formatear las calificaciones como tabla
                const responseMessage = formatCalificaciones(calificaciones);
                bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
            }
        } else if (userContext[chatId]?.option === '2') {
            // Calcular el promedio general del estudiante
            const promedio = await calcularPromedioGeneral(userMessage);
            const responseMessage = formatCalificaciones({ studentName: 'El estudiante', calificacion: promedio }, true);

            // Enviar el resultado del promedio general al usuario
            bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
        } else {
            // Si no hay contexto válido, enviar un mensaje de error
            bot.sendMessage(chatId, 'Opción no válida. Por favor, elige una opción válida del menú.');
        }

        // Limpiar el contexto del usuario después de procesar la solicitud
        delete userContext[chatId];
    } catch (error) {
        console.error('Error al procesar la solicitud:', error);
        bot.sendMessage(chatId, 'Ocurrió un error al procesar la solicitud. Por favor, inténtalo de nuevo más tarde.');
    }
});

// Iniciar el servidor Express
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});
