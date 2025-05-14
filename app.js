const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey',
  resave: false,
  saveUninitialized: true
}));

// PostgreSQL Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect((err, client, done) => {
  if (err) {
    console.error("Error connecting to PostgreSQL database: " + err.message);
  } else {
    console.log("Connected to PostgreSQL database.");

    // Create 'users' table if it doesn't exist
    client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT
      );
    `, (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log('Users table is ready.');
      }
    });

    // Create 'search_log' table if it doesn't exist
    client.query(`
      CREATE TABLE IF NOT EXISTS search_log (
        id SERIAL PRIMARY KEY,
        city TEXT,
        lat REAL,
        lon REAL
      );
    `, (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log('Search log table is ready.');
      }
    });

    done();
  }
});

// Routes for login and register
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('register', { error: null });
});

// Handle POST request for login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  pool.query('SELECT * FROM users WHERE email = $1', [email], async (err, result) => {
    if (err) {
      console.error(err);
      return res.render('login', { error: 'Error occurred. Please try again.' });
    }

    const user = result.rows[0];

    if (!user) {
      return res.render('login', { error: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid password.' });
    }

    req.session.userId = user.id;
    req.session.userName = user.name || user.email;
    res.redirect('/');
  });
});

// Handle POST request for registration
app.post('/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match.' });
  }

  pool.query('SELECT * FROM users WHERE email = $1', [email], async (err, result) => {
    if (err) {
      console.error(err);
      return res.render('register', { error: 'Error occurred. Please try again.' });
    }

    const existingUser = result.rows[0];

    if (existingUser) {
      return res.render('register', { error: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3)', [name, email, hashedPassword], (err) => {
      if (err) {
        console.error(err);
        return res.render('register', { error: 'Error occurred. Please try again.' });
      }
      res.redirect('/login');
    });
  });
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("There was an issue logging you out. Please try again.");
    }
    
    res.redirect('/login');  // Redirect to login page after successful logout
  });
});


// Weather Routes
app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  res.render('index', {
    weather: null,
    forecast: null,
    hourlyForecast: null,
    airPollution: null,
    error: null,
    userName: req.session.userName || 'Guest'
  });
});

// Route to handle location-based search
app.post('/location', async (req, res) => {
  const { lat, lon } = req.body;
  const apiKey = process.env.WEATHER_API_KEY;

  try {
    const weatherURL = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastURL = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const airPollutionURL = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;

    const [weatherRes, forecastRes, airPollutionRes] = await Promise.all([
      axios.get(weatherURL),
      axios.get(forecastURL),
      axios.get(airPollutionURL),
    ]);

    const weather = weatherRes.data;
    const forecast = forecastRes.data.list.filter(item =>
      item.dt_txt.includes('12:00:00')
    );
    const hourlyForecast = forecastRes.data.list.slice(0, 6);
    const airPollution = airPollutionRes.data?.list[0] || null;

    // Log the geolocation search in the search_log table
    pool.query('INSERT INTO search_log (city, lat, lon) VALUES ($1, $2, $3)', ['User Location', lat, lon], (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log('Location search logged successfully');
      }
    });

    res.render('index', {
      weather,
      forecast,
      hourlyForecast,
      airPollution,
      error: null,
      userName: req.session.userName || 'Guest'
    });

  } catch (err) {
    console.error(err.message);
    res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Unable to retrieve weather data for your location. Please try again.',
      userName: req.session.userName || 'Guest'
    });
  }
});

// Route to handle manual city search
app.post('/manual', async (req, res) => {
  const city = req.body.city.trim();
  const apiKey = process.env.WEATHER_API_KEY;

  if (!city) {
    return res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Please enter a city name.',
      userName: req.session.userName || 'Guest'
    });
  }

  try {
    const geocodingURL = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}`;
    const geocodeRes = await axios.get(geocodingURL);
    const { lat, lon } = geocodeRes.data.coord;

    const weatherURL = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastURL = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const airPollutionURL = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;

    const [weatherRes, forecastRes, airPollutionRes] = await Promise.all([
      axios.get(weatherURL),
      axios.get(forecastURL),
      axios.get(airPollutionURL),
    ]);

    const weather = weatherRes.data;
    const forecast = forecastRes.data.list.filter(item =>
      item.dt_txt.includes('12:00:00')
    );
    const hourlyForecast = forecastRes.data.list.slice(0, 6);
    const airPollution = airPollutionRes.data?.list[0] || null;

    // Log the city search in the search_log table
    pool.query('INSERT INTO search_log (city, lat, lon) VALUES ($1, $2, $3)', [city, lat, lon], (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log('Manual search logged successfully');
      }
    });

    res.render('index', {
      weather,
      forecast,
      hourlyForecast,
      airPollution,
      error: null,
      userName: req.session.userName || 'Guest'
    });

  } catch (err) {
    console.error(err.message);
    res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Unable to retrieve weather data. Please try again.',
      userName: req.session.userName || 'Guest'
    });
  }
});

// Route to provide search statistics for the chart
app.get('/search-stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT city, COUNT(*) as count
      FROM search_log
      GROUP BY city
      ORDER BY count DESC
      LIMIT 10;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch search statistics.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
