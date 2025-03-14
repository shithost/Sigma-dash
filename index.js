require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const flash = require('connect-flash');
const faker = require('faker');
const fs = require('fs');
const path = require('path');

const app = express();

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.set('view engine', 'ejs');

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_REDIRECT_URI,
  scope: ['identify', 'email']
},
(accessToken, refreshToken, profile, done) => {
  console.log('Discord Profile:', profile);
  return done(null, profile);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

const checkVPN = async (req, res, next) => {
  if (!config.vpncheck) {
    return next();
  }

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  try {
    const response = await axios.get(`http://proxycheck.io/v2/${ip}?key=${process.env.PROXYCHECK_API_KEY}&vpn=1&proxy=1&asn=1&node=1&port=1&seen=1&inf=1&days=180`);
    const data = response.data[ip];
    if (data.proxy === 'yes' || data.vpn === 'yes' || data.tor === 'yes') {
      return res.status(403).send('VPN, Proxy, or Tor is not allowed.');
    }
    next();
  } catch (error) {
    console.error('Error checking VPN:', error);
    res.status(500).send('Internal Server Error');
  }
};

const generateRandomPassword = (length = 10) => {
  const characters = 'QWERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm1234567890';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return password;
};

const createUserOnPterodactyl = async (email, username, password) => {
  const firstName = faker.name.firstName();
  const lastName = faker.name.lastName();

  try {
    const response = await axios.post(`${process.env.PTERODACTYL_PANEL_URL}/api/application/users`, {
      email: email,
      username: username,
      first_name: firstName,
      last_name: lastName,
      password: password
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const pterodactylUser = response.data;
    const pterodactylUserId = pterodactylUser.attributes.id;

    const defaultCpu = config['default-cpu'];
    const defaultRam = config['default-ram'];
    const defaultDisk = config['default-disk'];
    const defaultCoins = config['default-coins'] || 0;

    const users = readUsers();
    users[user.id] = {
      email: email,
      password: password,
      id: pterodactylUserId,
      cpu: defaultCpu,
      ram: defaultRam,
      disk: defaultDisk,
      coins: defaultCoins
    };

    writeUsers(users);

    return pterodactylUser;
  } catch (error) {
    console.error('Error creating user on Pterodactyl:', error);
    throw error;
  }
};

const checkUserExistsByEmail = async (email) => {
  try {
    const response = await axios.get(`${process.env.PTERODACTYL_PANEL_URL}/api/application/users?filter[email]=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    return response.data.data.length > 0;
  } catch (error) {
    console.error('Error checking user existence on Pterodactyl:', error);
    throw error;
  }
};

const readUsers = () => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    console.error('Error reading users.json:', error);
    throw error;
  }
};

const writeUsers = (users) => {
  try {
    fs.writeFileSync(path.join(__dirname, 'users.json'), JSON.stringify(users, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing users.json:', error);
    throw error;
  }
};

const getAllServers = async () => {
  try {
    const response = await axios.get(`${process.env.PTERODACTYL_PANEL_URL}/api/application/servers`, {
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('Error fetching all servers:', error);
    throw error;
  }
};

const getUserServers = async (pterodactylUserId) => {
  try {
    const allServers = await getAllServers();
    const userServers = allServers.filter(server => server.attributes.user === pterodactylUserId);
    return userServers;
  } catch (error) {
    console.error('Error fetching user servers:', error);
    throw error;
  }
};

app.use((req, res, next) => {
  res.locals.messages = req.flash();
  next();
});

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/dashboard');
  } else {
    res.render('index', { hostingName: process.env.HOSTING_NAME || 'Default Hosting Name', activeRoute: '/' });
  }
});

app.get('/dashboard', (req, res) => {
  if (req.isAuthenticated()) {
    const user = req.user;
    const users = readUsers();
    const userDetails = users[user.id] || {};

    res.render('dashboard', { 
      hostingName: process.env.HOSTING_NAME, 
      user: req.user, 
      activeRoute: '/dashboard', 
      cpu: userDetails.cpu, 
      ram: userDetails.ram, 
      disk: userDetails.disk,
      coins: userDetails.coins
    });
  } else {
    res.redirect('/');
  }
});

app.get('/servers', (req, res) => {
  if (req.isAuthenticated()) {
    const user = req.user;
    const users = readUsers();
    const userDetails = users[user.id] || {};

    if (!userDetails.id) {
      return res.status(400).send('Pterodactyl user ID not found.');
    }

    getUserServers(userDetails.id)
      .then(servers => {
        res.render('servers', { 
          hostingName: process.env.HOSTING_NAME, 
          user: req.user, 
          activeRoute: '/servers', 
          cpu: userDetails.cpu, 
          ram: userDetails.ram, 
          disk: userDetails.disk,
          coins: userDetails.coins, 
          servers: servers || []
        });
      })
      .catch(error => {
        console.error('Error fetching user servers:', error);
        res.status(500).send('Error fetching your servers. Please try again later.');
      });
  } else {
    res.redirect('/');
  }
});

app.get('/store', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('store', { hostingName: process.env.HOSTING_NAME, user: req.user, activeRoute: '/store', coins: req.user.coins });
  } else {
    res.redirect('/');
  }
});

app.get('/earn', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('earn', { hostingName: process.env.HOSTING_NAME, user: req.user, activeRoute: '/earn', coins: req.user.coins });
  } else {
    res.redirect('/');
  }
});

app.get('/account', (req, res) => {
  if (req.isAuthenticated()) {
    const user = req.user;
    const users = readUsers();
    const userDetails = users[user.id] || {};

    res.render('account', { 
      hostingName: process.env.HOSTING_NAME, 
      user: req.user, 
      activeRoute: '/account', 
      cpu: userDetails.cpu, 
      ram: userDetails.ram, 
      disk: userDetails.disk,
      coins: userDetails.coins
    });
  } else {
    res.redirect('/');
  }
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

app.get('/auth/discord', checkVPN, passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }),
  async (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user;
      console.log('Discord Profile:', user);

      const email = user.emails && user.emails.length > 0 ? user.emails[0].value : user.email;

      if (!email) {
        return res.status(400).send('Email is not available from Discord. Please ensure your Discord account has an email associated with it.');
      }

      const username = user.id;
      const password = generateRandomPassword();

      try {
        const userExists = await checkUserExistsByEmail(email);
        if (userExists) {
          req.flash('info', 'Your Pterodactyl account already exists.');
          return res.redirect('/dashboard');
        }

        const pterodactylUser = await createUserOnPterodactyl(email, username, password);
        const pterodactylUserId = pterodactylUser.attributes.id;

        const defaultCpu = config['default-cpu'];
        const defaultRam = config['default-ram'];
        const defaultDisk = config['default-disk'];

        const users = readUsers();
        users[user.id] = {
          email: email,
          password: password,
          id: pterodactylUserId,
          cpu: defaultCpu,
          ram: defaultRam,
          disk: defaultDisk
        };

        writeUsers(users);

        req.flash('info', `Your Pterodactyl account has been created. Your password is: ${password}`);
        res.redirect('/dashboard');
      } catch (error) {
        console.error('Error creating user on Pterodactyl:', error);
        res.status(500).send('Error creating Pterodactyl account. Please try again later.');
      }
    } else {
      res.redirect('/');
    }
  });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});