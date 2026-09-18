// E-STIM REMOTE TURN privacy configuration.
// Keep null until a trusted TURN service is deployed.
// When configured, the app automatically uses iceTransportPolicy: "relay".
window.ESTIM_TURN_CONFIG = null;

/*
Example with short-lived TURN credentials issued by your own backend:

window.ESTIM_TURN_CONFIG = {
  iceServers: [
    {
      urls: [
        "turns:turn.example.com:5349?transport=tcp",
        "turn:turn.example.com:3478?transport=udp"
      ],
      username: "SHORT_LIVED_USERNAME",
      credential: "SHORT_LIVED_CREDENTIAL"
    }
  ]
};

Do not commit permanent production TURN passwords to this static file.
*/
