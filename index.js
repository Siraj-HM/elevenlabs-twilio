require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

app.post('/twilio/inbound_call', async (req, res) => {
    const twiml = new Twilio.twiml.VoiceResponse();
    
    twiml.connect().stream({
        url: `https://api.elevenlabs.io/v1/telephony`,
        track: 'both_tracks'
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
