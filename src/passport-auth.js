// passport-config.js
import path from 'path'
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

// FIX: Properly parse the comma-separated email list
const allowedEmails = process.env.ALLOWED_EMAILS
    ? process.env.ALLOWED_EMAILS.split(',').map(email => email.trim())
    : [];

console.log('Allowed emails configured:', allowedEmails); // Debug log

// Configure Google OAuth 2.0 strategy for Passport.js
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            callbackURL: process.env.CALLBACK_URL,
        },
        (accessToken, refreshToken, profile, done) => {
            const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

            console.log('Attempting authentication for:', email); // Debug log

            if (!email) {
                console.log('No email found in profile');
                return done(null, false, { message: 'No email found in profile' });
            }

            if (!allowedEmails.includes(email)) {
                console.log('Email not authorized:', email);
                console.log('Allowed emails are:', allowedEmails); // Debug log
                return done(null, false, { message: 'Email not authorized' });
            }

            console.log('Email authorized, creating session for:', email); // Debug log

            // Create a cleaner user object
            const user = {
                id: profile.id,
                email: email,
                name: profile.displayName,
                picture: profile.photos && profile.photos[0] ? profile.photos[0].value : null
            };

            return done(null, user);
        }
    )
);

// Serialize and deserialize user information for Passport.js
passport.serializeUser((user, done) => {
    console.log('Serializing user:', user.email); // Debug log
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log('Deserializing user:', user.email); // Debug log
    done(null, user);
});

export default passport;