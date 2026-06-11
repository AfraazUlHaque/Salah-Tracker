const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const adhan = require('adhan');
const Datastore = require('nedb-promises');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 🛠️ RENDER PERSISTENT DISK CONFIGURATION (DATA SAFE AND REUSE GATEWAY)
// Render par /opt/render/project/src/data path mount karenge taaki server restart par database wipe na ho
const dbFolder = process.env.NODE_ENV === 'production' 
    ? '/opt/render/project/src/data' 
    : path.join(__dirname, '.');

// Databases Initializations (Persistent Local Files)
const userDB = Datastore.create({ filename: path.join(dbFolder, 'users.db'), autoload: true });
const historyDB = Datastore.create({ filename: path.join(dbFolder, 'history.db'), autoload: true });

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static('public'));

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// ── 1. AUTHENTICATION API ROUTING ──

// Register User
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required." });
        }

        const existingUser = await userDB.findOne({ username: username.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({ error: "Username already taken." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await userDB.insert({
            username: username.toLowerCase().trim(),
            password: hashedPassword,
            createdAt: new Date()
        });

        res.json({ success: true, username: newUser.username });
    } catch (err) {
        res.status(500).json({ error: "Registration pipeline failure." });
    }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await userDB.findOne({ username: username.toLowerCase().trim() });
        
        if (!user) {
            return res.status(400).json({ error: "User not found." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid password credentials." });
        }

        res.json({ success: true, username: user.username });
    } catch (err) {
        res.status(500).json({ error: "Login server failure." });
    }
});

// ── 2. PRAYER TRACKING ROUTINES ──

// Check/Uncheck Namaz Checklist
app.post('/api/history/toggle', async (req, res) => {
    try {
        const { username, dateKey, prayerKey, isChecked } = req.body;
        if (!username || !dateKey || !prayerKey) {
            return res.status(400).json({ error: "Missing tracking data parameters." });
        }

        let record = await historyDB.findOne({ username, dateKey, type: { $exists: false } });
        if (!record) {
            record = { username, dateKey, prayers: {} };
        }

        record.prayers[prayerKey] = isChecked;
        await historyDB.update({ username, dateKey, type: { $exists: false } }, record, { upsert: true });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Database write error." });
    }
});

// Fetch Live Analytics Data
app.get('/api/history/analytics', async (req, res) => {
    try {
        const username = req.query.username;
        if (!username) {
            return res.status(400).json({ error: "Username parameter missing." });
        }

        // Database se is user ke saare records nikalie
        const userHistory = await historyDB.find({ username: username });

        let totalPrayersOffered = 0;

        // Saari namazo ke true checks ko calculate karein
        userHistory.forEach(day => {
            if (day.prayers) {
                Object.values(day.prayers).forEach(status => {
                    if (status === true || status === 'true') totalPrayersOffered++;
                });
            }
        });

        const daysTracked = userHistory.length;

        // Response bilkul saaf format mein bhejien
        res.json({
            totalPrayersOffered: totalPrayersOffered,
            daysTracked: daysTracked > 0 ? daysTracked : 1,
            rawHistory: userHistory
        });
    } catch (error) {
        res.status(500).json({ error: "Analytics data fetch failure." });
    }
});

// ── 3. ASTRONOMICAL PRAYER TIMINGS CALCULATOR ──
app.get('/api/timings', (req, res) => {
    try {
        const lat = parseFloat(req.query.lat) || 28.5616;
        const lng = parseFloat(req.query.lng) || 77.2802;

        const coordinates = new adhan.Coordinates(lat, lng);
        const params = adhan.CalculationMethod.Karachi();
        params.madhab = adhan.Madhab.Hanafi;
        
        const date = new Date();
        const prayerTimes = new adhan.PrayerTimes(coordinates, date, params);

        const formatTime = (timeObj) => {
            if (!timeObj || isNaN(timeObj.getTime())) return '--:-- --';
            return timeObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        };

        const maghribMs = prayerTimes.maghrib.getTime();
        const nextFajrTime = new Date(prayerTimes.fajr.getTime());
        nextFajrTime.setDate(nextFajrTime.getDate() + 1);
        const nextFajrMs = nextFajrTime.getTime();
        const totalNightMs = nextFajrMs - maghribMs;

        const midnightTime = new Date(maghribMs + (totalNightMs / 2));
        const lastThirdTime = new Date(nextFajrMs - (totalNightMs / 3));

        res.json({
            fajr: formatTime(prayerTimes.fajr),
            sunrise: formatTime(prayerTimes.sunrise),
            dhuhr: formatTime(prayerTimes.dhuhr),
            asr: formatTime(prayerTimes.asr),
            maghrib: formatTime(prayerTimes.maghrib),
            isha: formatTime(prayerTimes.isha),
            midnight: formatTime(midnightTime),
            lastThird: formatTime(lastThirdTime)
        });
    } catch (error) {
        res.status(500).json({ error: "Calculations breakdown inside node thread." });
    }
});

app.get('/api/hadith', (req, res) => {
    const hadithPool = [

    { arabic: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ', text: 'Actions are judged by their intentions, and every person will get what they intended.', source: 'Sahih al-Bukhari 1' },

    { arabic: 'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ', text: 'The best among you are those who learn the Quran and teach it.', source: 'Sahih al-Bukhari 5027' },

    { arabic: 'الدُّعَاءُ هُوَ الْعِبَادَةُ', text: 'Supplication (Dua) is the essence of worship itself.', source: 'Sunan Abi Dawud 1479' },

    { arabic: 'مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ', text: 'Whoever takes a path upon which to obtain knowledge, Allah makes the path to Paradise easy for him.', source: 'Sahih Muslim 2699' },

    { arabic: 'بُنِيَ الإِسْلاَمُ عَلَى خَمْسٍ', text: 'Islam is built upon five pillars: Testifying that there is no god but Allah, establishing prayer, giving Zakat, Hajj, and fasting Ramadan.', source: 'Sahih al-Bukhari 8' },

    { arabic: 'الدِّينُ النَّصِيحَةُ', text: 'The religion is sincere advice.', source: 'Sahih Muslim 55' },

    { arabic: 'الْجَنَّةُ تَحْتَ أَقْدَامِ الأُمَّهَاتِ', text: 'Paradise lies beneath the feet of mothers.', source: 'Sunan al-Nasa\'i 3104' },

    { arabic: 'لاَ يَدْخُلُ الْجَنَّةَ قَاطِعٌ', text: 'The one who severs ties of kinship will not enter Paradise.', source: 'Sahih al-Bukhari 5984' },

    { arabic: 'الْمُسْلِمُ مَنْ سَلِمَ الْمُسْلِمُونَ مِنْ لِسَانِهِ وَيَدِهِ', text: 'A true Muslim is the one from whose tongue and hand other Muslims are safe.', source: 'Sahih al-Bukhari 10' },

    { arabic: 'لاَ يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لأَخِيهِ مَا يُحِبَّ لِنَفْسِهِ', text: 'None of you truly believes until he loves for his brother what he loves for himself.', source: 'Sahih al-Bukhari 13' },

    { arabic: 'مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ', text: 'Whoever believes in Allah and the Last Day should speak good or remain silent.', source: 'Sahih al-Bukhari 6018' },

    { arabic: 'الطهُورُ شَطْرُ الإِيمَانِ', text: 'Purity is half of faith.', source: 'Sahih Muslim 223' },

    { arabic: 'اتَّقِ اللَّهَ حَيْثُمَا كُنْتَ، وَأَتْبِعِ السَّيِّئَةَ الْحَسَنَةَ تَمْحُهَا', text: 'Fear Allah wherever you are, and follow up a bad deed with a good deed which will wipe it out.', source: 'Jami` at-Tirmidhi 1987' },

    { arabic: 'كُلُّ مَعْرُوفٍ صَدَقَةٌ', text: 'Every good deed is a form of charity.', source: 'Sahih al-Bukhari 6021' },

    { arabic: 'تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ لَكَ صَدَقَةٌ', text: 'Your smiling in the face of your brother is charity for you.', source: 'Jami` at-Tirmidhi 1956' },

    { arabic: 'إِنَّ اللَّهَ جَمِيلٌ يُحِبُّ الْجَمَالَ', text: 'Allah is Beautiful and He loves beauty.', source: 'Sahih Muslim 91' },

    { arabic: 'السَّاعِي عَلَى الأَرْمَلَةِ وَالْمِسْكِينِ كَالْمُجَاهِدِ فِي سَبِيلِ اللَّهِ', text: 'The one who looks after a widow or a poor person is like a warrior fighting who fights in the cause of Allah.', source: 'Sahih al-Bukhari 5353' },

    { arabic: 'مَنْ لاَ يَرْحَمِ النَّاسَ لاَ يَرْحَمْهُ اللَّهُ', text: 'He who does not show mercy to people will not be shown mercy by Allah.', source: 'Sahih Muslim 2319' },

    { arabic: 'الْكَلِمَةُ الطَّيِّبَةُ صَدَقَةٌ', text: 'A good, pleasant word is a form of charity.', source: 'Sahih al-Bukhari 2989' },

    { arabic: 'إِنَّ اللَّهَ رَفِيقٌ يُحِبُّ الرِّفْقَ', text: 'Allah is gentle and He loves gentleness in all matters.', source: 'Sahih al-Bukhari 6927' },

    { arabic: 'أَقْرَبُ مَا يَكُونُ الْعَبْدُ مِنْ رَبِّهِ وَهُوَ سَاجِدٌ', text: 'The nearest a servant comes to his Lord is when he is prostrating (in Sujud).', source: 'Sahih Muslim 482' },

    { arabic: 'الْعَهْدُ الَّذِي بَيْنَنَا وَبَيْنَهُمُ الصَّلاَةُ فَمَنْ تَرَكَهَا فَقَدْ كَفَرَ', text: 'The covenant that stands between us and them is the prayer; whoever abandons it has disbelieved.', source: 'Sunan al-Nasa\'i 463' },

    { arabic: 'مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ', text: 'Whoever prays the two cool prayers (Fajr and Asr) will enter Paradise.', source: 'Sahih al-Bukhari 574' },

    { arabic: 'عَلَيْكَ بِكَثْرَةِ السُّجُودِ لِلَّهِ', text: 'Make prostrations to Allah frequently, for you will not make a prostration but Allah will raise your status.', source: 'Sahih Muslim 488' },

    { arabic: 'الصَّلاَةُ الْخَمْسُ وَالْجُمُعَةُ إِلَى الْجُمُعَةِ كَفَّارَاتٌ لِمَا بَيْنَهُنَّ', text: 'The five daily prayers and from one Friday to the next are expiations for sins committed in between them.', source: 'Sahih Muslim 233' },

    { arabic: 'أَوَّلُ مَا يُحَاسَبُ بِهِ الْعَبْدُ يَوْمَ الْقِيَامَةِ مِنْ عَمَلِهِ صَلاَتُهُ', text: 'The first thing for which a servant will be brought to account on the Day of Judgment will be his prayer.', source: 'Jami` at-Tirmidhi 413' },

    { arabic: 'يَسِّرُوا وَلاَ تُعَسِّرُوا، وَبَشِّرُوا وَلاَ تُنَفِّرُوا', text: 'Make things easy for people and do not make them difficult, and give good tidings and do not turn them away.', source: 'Sahih al-Bukhari 69' },

    { arabic: 'إِنَّ لِكُلِّ دِينٍ خُلُقًا وَخُلُقُ الإِسْلاَمِ الْحَيَاءُ', text: 'Every religion has a distinct characteristic, and the characteristic of Islam is modesty (Haya).', source: 'Sunan Ibn Majah 4181' },

    { arabic: 'إِنَّ الصِّدْقَ يَهْدِي إِلَى الْبِرِّ', text: 'Truthfulness leads to righteousness, and righteousness leads to Paradise.', source: 'Sahih al-Bukhari 6094' },

    { arabic: 'إِيَّاكُمْ وَالظَّنَّ فَإِنَّ الظَّنَّ أَكْذَبُ الْحَدِيثِ', text: 'Beware of suspicion, for suspicion is the worst of false tales.', source: 'Sahih al-Bukhari 6064' },

    { arabic: 'مَنْ عَمِلَ عَمَلاً لَيْسَ عَلَيْهِ أَمْرُنَا فَهُوَ رَدٌّ', text: 'He who does an act which our matter (religion) is not in agreement with, it will be rejected.', source: 'Sahih Muslim 1718' },

    { arabic: 'آيَةُ الْمُنَافِقِ ثَلاَثٌ: إِذَا حَدَّثَ كَذَبَ، وَإِذَا وَعَدَ أَخْلَفَ، وَإِذَا اؤْتُمِنَ خَانَ', text: 'The signs of a hypocrite are three: whenever he speaks he lies, whenever he promises he breaks it, and whenever he is trusted he betrays.', source: 'Sahih al-Bukhari 33' },

    { arabic: 'الْيَدُ الْعُلْيَا خَيْرٌ مِنَ الْيَدِ السُّفْلَى', text: 'The upper hand (the giver) is better than the lower hand (the receiver).', source: 'Sahih al-Bukhari 1429' },

    { arabic: 'مَنْ غَشَّنَا فَلَيْسَ مِنَّا', text: 'Whoever cheats us is not one of us.', source: 'Sahih Muslim 101' },

    { arabic: 'الْقَنَاعَةُ مَالٌ لاَ يَنْفَدُ', text: 'Contentment is a wealth that is never exhausted.', source: 'Al-Mu\'jam al-Awsat 7150' },

    { arabic: 'لَيْسَ الْغِنَى عَنْ كَثْرَةِ الْعَرَضِ وَلَكِنَّ الْغِنَى غِنَى النَّفْسِ', text: 'Richness does not lie in the abundance of worldly goods, but true richness is the richness of the soul.', source: 'Sahih al-Bukhari 6446' },

    { arabic: 'الْمَرْءُ مَعَ مَنْ أَحَبَّ', text: 'A person will be with those whom he loves on the Day of Judgment.', source: 'Sahih al-Bukhari 6168' },

    { arabic: 'لاَ يَشْكُرُ اللَّهَ مَنْ لاَ يَشْكُرُ النَّاسَ', text: 'He who does not thank people does not thank Allah.', source: 'Sunan Abi Dawud 4811' },

    { arabic: 'خِيَارُكُمْ أَحَاسِنُكُمْ أَخْلاَقًا', text: 'The best among you are those who have the best manners and character.', source: 'Sahih al-Bukhari 6035' },

    { arabic: 'أَكْمَلُ الْمُؤْمِنِينَ إِيمَانًا أَحْسَنُهُمْ خُلُقًا', text: 'The most perfect of believers in faith are those with the best character.', source: 'Jami` at-Tirmidhi 1162' },

    { arabic: 'سَبَابُ الْمُسْلِمِ فُسُوقٌ وَقِتَالُهُ كُفْرٌ', text: 'Abusing a Muslim is an outrage and fighting him is disbelief.', source: 'Sahih al-Bukhari 48' },

    { arabic: 'الظُّلْمُ ظُلُمَاتٌ يَوْمَ الْقِيَامَةِ', text: 'Injustice will result in deep darkness on the Day of Resurrection.', source: 'Sahih al-Bukhari 2447' },

    { arabic: 'مَنْ نَفَّسَ عَنْ مُؤْمِنٍ كُرْبَةً نَفَّسَ اللَّهُ عَنْهُ كُرْبَةً', text: 'Whoever relieves a believer of a distress in this world, Allah will relieve him of a distress on the Day of Resurrection.', source: 'Sahih Muslim 2699' },

    { arabic: 'مَنْ سَتَرَ مُسْلِمًا سَتَرَهُ اللَّهُ فِي الدُّنْيَا وَالآخِرَةِ', text: 'Whoever conceals the faults of a Muslim, Allah will conceal his faults in this world and the Next.', source: 'Sahih Muslim 2699' },

    { arabic: 'وَاللَّهُ فِي عَوْنِ الْعَبْدِ مَا كَانَ الْعَبْدُ فِي عَوْنِ أَخِيهِ', text: 'Allah helps His servant as long as the servant helps his brother.', source: 'Sahih Muslim 2699' },

    { arabic: 'الدَّالُّ عَلَى الْخَيْرِ كَفَاعِلِهِ', text: 'The one who guides others to a good deed gets the same reward as the doer.', source: 'Jami` at-Tirmidhi 2671' },

    { arabic: 'إِنَّ الدِّينَ يُسْرٌ', text: 'Religion is easy and accommodating.', source: 'Sahih al-Bukhari 39' },

    { arabic: 'أَحَبُّ الأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ', text: 'The most beloved of deeds to Allah are those that are most consistent, even if they are small.', source: 'Sahih al-Bukhari 5861' },

    { arabic: 'الْمُؤْمِنُ الْقَوِيُّ خَيْرٌ وَأَحَبُّ إِلَى اللَّهِ مِنَ الْمُؤْمِنِ الضَّعِيفِ', text: 'The strong believer is better and more beloved to Allah than the weak believer.', source: 'Sahih Muslim 2664' },

    { arabic: 'احْرِصْ عَلَى مَا يَنْفَعُكَ وَاسْتَعِنْ بِاللَّهِ وَلاَ تَعْجِزْ', text: 'Cherish that which benefits you, seek help from Allah, and do not feel helpless.', source: 'Sahih Muslim 2664' },

    { arabic: 'عَجَبًا لأَمْرِ الْمُؤْمِنِ إِنَّ أَمْرَهُ كُلَّهُ خَيْرٌ', text: 'How wonderful is the case of a believer! There is good for him in everything.', source: 'Sahih Muslim 2999' },

    { arabic: 'مَا مَلأَ آدَمِيٌّ وِعَاءً شَرًّا مِنْ بَطْنٍ', text: 'A human being fills no vessel worse than his own stomach.', source: 'Jami` at-Tirmidhi 2380' },

    { arabic: 'الْحَمْدُ لِلَّهِ تَمْلأُ الْمِيزَانَ', text: 'Praise be to Allah (Al-Hamdulillah) fills the scale of good deeds.', source: 'Sahih Muslim 223' },

    { arabic: 'الصَّبْرُ ضِياءٌ', text: 'Patience is a bright, guiding light.', source: 'Sahih Muslim 223' },

    { arabic: 'مَا أُوتِيَ أَحَدٌ عَطَاءً خَيْرًا وَأَوْسَعَ مِنَ الصَّبْرِ', text: 'No one has been given a blessing better and more comprehensive than patience.', source: 'Sahih al-Bukhari 1469' },

    { arabic: 'مَنْ صَامَ رَمَضَانَ إِيمَانًا وَاحْتِسَابًا غُفِرَ لَهُ مَا تَقَدَّمَ مِنْ ذَنْبِهِ', text: 'Whoever fasts Ramadan out of sincere faith and hoping for reward, his past sins will be forgiven.', source: 'Sahih al-Bukhari 38' },

    { arabic: 'لِكُلِّ شَيْءٍ زَكَاةٌ وَزَكَاةُ الْجَسَدِ الصَّوْمُ', text: 'Everything has its purity tax, and the purity tax of the body is fasting.', source: 'Sunan Ibn Majah 1745' },

    { arabic: 'الصِّيَامُ جُنَّةٌ', text: 'Fasting is a protective shield.', source: 'Sahih al-Bukhari 1894' },

    { arabic: 'عُمْرَةٌ فِي رَمَضَانَ تَعْدِلُ حَجَّةً', text: 'Umrah performed during Ramadan is equal in reward to performing Hajj.', source: 'Sahih al-Bukhari 1782' },

    { arabic: 'تَسَحَّرُوا فَإِنَّ فِي السَّحُورِ بَرَكَةً', text: 'Eat the pre-dawn meal (Suhoor), for indeed there is a blessing in it.', source: 'Sahih al-Bukhari 1923' },

    { arabic: 'مَنْ لَمْ يَدَعْ قَوْلَ الزُّورِ وَالْعَمَلَ بِهِ فَلَيْسَ لِلَّهِ حَاجَةٌ فِي أَنْ يَدَعَ طَعَامَهُ وَشَرَابَهُ', text: 'Whoever does not give up false speech and evil deeds, Allah has no need for him to leave his food and drink.', source: 'Sahih al-Bukhari 1903' },

    { arabic: 'صَنَائِعُ الْمَعْرُوفِ تَقِي مَصَارِعَ السُّوءِ', text: 'Good deeds protect a person from an evil, untimely death.', source: 'Al-Mustadrak 572' },

    { arabic: 'أَنَا وَكَافِلُ الْيَتِيمِ فِي الْجَنَّةِ هَكَذَا', text: 'The one who takes care of an orphan and myself will be together in Paradise like this (joining index and middle fingers).', source: 'Sahih al-Bukhari 5304' },

    { arabic: 'مَنْ قَرَأَ حَرْفًا مِنْ كِتَابِ اللَّهِ فَلَهُ بِهِ حَسَنَةٌ', text: 'Whoever recites a single letter from the Book of Allah will receive one good deed, and ten like it.', source: 'Jami` at-Tirmidhi 2910' },

    { arabic: 'مَثَلُ الَّذِي يَذْكُرُ رَبَّهُ وَالَّذِي لاَ يَذْكُرُ رَبَّهُ مَثَلُ الْحَيِّ وَالْمَيِّتِ', text: 'The example of the one who remembers his Lord in comparison to one who does not is like the living and the dead.', source: 'Sahih al-Bukhari 6407' },

    { arabic: 'جَدِّدُوا إِيمَانَكُمْ بِكَلِمَةِ لاَ إِلَهَ إِلاَّ اللَّهُ', text: 'Renew your faith constantly by declaring that there is no god but Allah.', source: 'Musnad Ahmad 8710' },

    { arabic: 'لأَنْ أَقُولَ سُبْحَانَ اللَّهِ وَالْحَمْدُ لِلَّهِ وَلاَ إِلَهَ إِلاَّ اللَّهُ وَاللَّهُ أَكْبَرُ أَحَبُّ إِلَيَّ مِمَّا طَلَعَتْ عَلَيْهِ الشَّمْسُ', text: 'To say SubhanAllah, Al-Hamdulillah, La ilaha illa Allah, and Allahu Akbar is more beloved to me than all the sun rises upon.', source: 'Sahih Muslim 2695' },

    { arabic: 'أَفْضَلُ الذِّكْرِ لاَ إِلَهَ إِلاَّ اللَّهُ', text: 'The best remembrance of Allah is the declaration: La ilaha illa Allah.', source: 'Jami` at-Tirmidhi 3383' },

    { arabic: 'كَلِمَتَانِ خَفِيفَتَانِ عَلَى اللِّسَانِ ثَقِيلَتَانِ فِي الْمِيزَانِ حَبِيبَتَانِ إِلَى الرَّحْمَنِ: سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ', text: 'Two words are light on the tongue, heavy on the scale, and loved by the Most Merciful: SubhanAllahi wa bihamdihi, SubhanAllahi al-Adheem.', source: 'Sahih al-Bukhari 6406' },

    { arabic: 'مَنْ صَلَّى عَلَيَّ وَاحِدَةً صَلَّى اللَّهُ عَلَيْهِ عَشْرًا', text: 'Whoever sends a single blessing upon me, Allah will send ten blessings upon him.', source: 'Sahih Muslim 384' },

    { arabic: 'الْبَخِيلُ مَنْ ذُكِرْتُ عِنْدَهُ فَلَمْ يُصَلِّ عَلَيَّ', text: 'The miserly person is the one in whose presence I am mentioned, and he does not send blessings upon me.', source: 'Jami` at-Tirmidhi 3546' },

    { arabic: 'إِنَّ اللَّهَ يَرْفَعُ بِهَذَا الْكِتَابِ أَقْوَامًا وَيَضَعُ بِهِ آخَرِينَ', text: 'Indeed, Allah raises nations up by this Book (the Quran) and downfalls others with it.', source: 'Sahih Muslim 817' },

    { arabic: 'الْمَاهِرُ بِالْقُرْآنِ مَعَ السَّفَرَةِ الْكِرَامِ الْبَرَرَةِ', text: 'The one who is proficient in the recitation of the Quran will be with the honorable and obedient angel scribes.', source: 'Sahih al-Bukhari 4937' },

    { arabic: 'اقْرَؤُوا الْقُرْآنَ فَإِنَّهُ يَأْتِي يَوْمَ الْقِيَامَةِ شَفِيعًا لأَصْحَابِهِ', text: 'Read the Quran, for it will come as an intercessor for its companions on the Day of Resurrection.', source: 'Sahih Muslim 804' },

    { arabic: 'إِنَّمَا بُعِثْتُ لأُتَمِّمَ صَالِحَ الأَخْلاَقِ', text: 'I was only sent to perfect noble, righteous character.', source: 'Musnad Ahmad 8952' },

    { arabic: 'لاَ تَبَاغَضُوا وَلاَ تَحَاسَدُوا وَلاَ تَدَابَرُوا', text: 'Do not hate one another, do not envy one another, and do not turn your backs on one another.', source: 'Sahih al-Bukhari 6065' },

    { arabic: 'الْمُؤْمِنُ مِرْآةُ الْمُؤْمِنِ', text: 'A believer is a mirror reflecting his fellow believer.', source: 'Sunan Abi Dawud 4918' },

    { arabic: 'لَيْسَ مِنَّا مَنْ لَمْ يَرْحَمْ صَغِيرَنَا وَيَعْرِفْ شَرَفَ كَبِيرَنَا', text: 'He is not one of us who does not show mercy to our young ones and recognize the honor of our elders.', source: 'Jami` at-Tirmidhi 1920' },

    { arabic: 'رِضَا الرَّبِّ فِي رِضَا الْوَالِدِ وَسُخْطُ الرَّبِّ فِي سُخْطُ الْوَالِدِ', text: 'The Lord’s pleasure is found in the parent’s pleasure, and the Lord’s anger is found in the parent’s anger.', source: 'Jami` at-Tirmidhi 1899' },

    { arabic: 'خَيْرُكُمْ خَيْرُكُمْ لأَهْلِهِ', text: 'The best among you are those who are best to their families.', source: 'Jami` at-Tirmidhi 3895' },

    { arabic: 'مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيُكْرِمْ جَارَهُ', text: 'Whoever believes in Allah and the Last Day must be honorable and kind to his neighbor.', source: 'Sahih al-Bukhari 6019' },

    { arabic: 'مَا زَالَ جِبْرِيلُ يُوصِينِي بِالْجَارِ حَتَّى ظَنَنْتُ أَنَّهُ سَيُوَرِّثُهُ', text: 'Angel Jibril kept advising me to be kind to neighbors until I thought he would include them as heirs.', source: 'Sahih al-Bukhari 6014' },

    { arabic: 'لاَ يَدْخُلُ الْجَنَّةَ مَنْ كَانَ فِي قَلْبِهِ مِثْقَالُ ذَرَّةٍ مِنْ كِبْرٍ', text: 'He who has even an atom’s weight of arrogance in his heart will not enter Paradise.', source: 'Sahih Muslim 91' },

    { arabic: 'الْكِبْرُ بَطَرُ الْحَقِّ وَغَمْطُ النَّاسِ', text: 'Arrogance is rejecting the truth and looking down upon people.', source: 'Sahih Muslim 91' },

    { arabic: 'مَنْ تَوَاضَعَ لِلَّهِ رَفَعَهُ اللَّهُ', text: 'Whoever humbles himself for the sake of Allah, Allah will elevate his status.', source: 'Sahih Muslim 2588' },

    { arabic: 'إِيَّاكُمْ وَالْحَسَدَ فَإِنَّ الْحَسَدَ يَأْكُلُ الْحَسَنَاتِ كَمَا تَأْكُلُ النَّارُ الْحَطَبَ', text: 'Avoid envy, for envy devours good deeds just as fire devours firewood.', source: 'Sunan Abi Dawud 4903' },

    { arabic: 'لاَ غِرَارَ فِي صَلاَةٍ وَلاَ تَسْلِيمٍ', text: 'There should be no deception or delusion in prayer or in interactions.', source: 'Sunan Abi Dawud 929' },

    { arabic: 'الْقَبْرُ أَوَّلُ مَنْزِلٍ مِنْ مَنَازِلِ الآخِرَةِ', text: 'The grave is the very first stage among the stages of the Hereafter.', source: 'Jami` at-Tirmidhi 2308' },

    { arabic: 'أَكْثِرُوا ذِكْرَ هَاذِمِ اللَّذَّاتِ: الْمَوْتِ', text: 'Remember frequently the destroyer of worldly pleasures: Death.', source: 'Jami` at-Tirmidhi 2307' },

    { arabic: 'الدُّنْيَا سِجْنُ الْمُؤْمِنِ وَجَنَّةُ الْكَافِرِ', text: 'This world is a prison for the believer and a paradise for the disbeliever.', source: 'Sahih Muslim 2956' },

    { arabic: 'كُنْ فِي الدُّنْيَا كَأَنَّكَ غَرِيبٌ أَوْ عَابِرُ سَبِيلٍ', text: 'Be in this world as if you were a stranger or a traveler passing through.', source: 'Sahih al-Bukhari 6416' },

    { arabic: 'الْحَيَاءُ لاَ يَأْتِي إِلاَّ بِخَيْرٍ', text: 'Modesty (Haya) brings nothing except goodness.', source: 'Sahih al-Bukhari 6117' },

    { arabic: 'الْحَيَاءُ مِنَ الإِيمَانِ', text: 'Modesty and shame are fundamental branches of true faith.', source: 'Sahih al-Bukhari 24' },

    { arabic: 'إِنَّ اللَّهَ يُحِبُّ إِذَا عَمِلَ أَحَدُكُمْ عَمَلاً أَنْ يُتْقِنَهُ', text: 'Allah loves that when any of you performs a task, you execute it with precision and mastery.', source: 'Al-Mu\'jam al-Awsat 897' },

    { arabic: 'أَعْطُوا الأَجِيرَ أَجْرَهُ قَبْلَ أَنْ يَجِفَّ عَرَقُهُ', text: 'Give the worker his wages before his sweat dries.', source: 'Sunan Ibn Majah 2443' },

    { arabic: 'الْبَيِّعَانِ بِالْخِيَارِ مَا لَمْ يَتَفَرَّقَا', text: 'Both parties in a business transaction have the right to cancel until they separate.', source: 'Sahih al-Bukhari 2079' },

    { arabic: 'التَّاجِرُ الصَّدُوقُ الأَمِينُ مَعَ النَّبِيِّينَ وَالصِّدِّيقِينَ وَالشُّهَدَاءِ', text: 'The truthful, trustworthy merchant will be associated with prophets, the truthful, and martyrs.', source: 'Jami` at-Tirmidhi 1209' },

    { arabic: 'مَا نَقَصَتْ صَدَقَةٌ مِنْ مَالٍ', text: 'Wealth is never decreased or diminished by giving charity.', source: 'Sahih Muslim 2588' },

    { arabic: 'مَنْ كَانَ فِي حَاجَةِ أَخِيهِ كَانَ اللَّهُ فِي حَاجَتِهِ', text: 'Whoever fulfills the needs of his brother, Allah will fulfill his needs.', source: 'Sahih al-Bukhari 2442' },

    { arabic: 'مَنْ دَعَا إِلَى هُدًى كَانَ لَهُ مِنَ الأَجْرِ مِثْلُ أُجُورِ مَنْ تَبِعَهُ', text: 'Whoever calls others to guidance will receive a reward equal to those who follow him.', source: 'Sahih Muslim 2674' },

    { arabic: 'إِذَا مَاتَ الإِنْسَانُ انْقَطَعَ عَنْهُ عَمَلُهُ إِلاَّ مِنْ ثَلاَثَةٍ: إِلاَّ مِنْ صَدَقَةٍ جَارِيَةٍ أَوْ عِلْمٍ يُنْتَفَعُ بِهِ أَوْ وَلَدٍ صَالِحٍ يَدْعُو لَهُ', text: 'When a human dies, his deeds come to an end except for three: ongoing charity, beneficial knowledge, or a righteous child who prays for him.', source: 'Sahih Muslim 1631' },

    { arabic: 'خَيْرُ النَّاسِ أَنْفَعُهُمْ لِلنَّاسِ', text: 'The best of people are those who are most beneficial to other people.', source: 'Al-Mu\'jam al-Awsat 5787' }

];
    res.json(hadithPool[Math.floor(Math.random() * hadithPool.length)]);
});

// ── 4. LIVE CHAT HUB SERVICE (WITH 24-HOUR AUTO-RENEW WINDOW) ──

app.get('/api/chat/history', async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        const messages = await historyDB.find({ 
            type: 'chat_message',
            timestampRaw: { $gte: twentyFourHoursAgo }
        }).sort({ timestampRaw: 1 });

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: "Failed to load fresh chat logs." });
    }
});

io.on('connection', (socket) => {
    socket.on('sendMessage', async (data) => {
        const msgObject = {
            type: 'chat_message',
            alias: data.username,
            text: data.text,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            timestampRaw: new Date()
        };
        try {
            await historyDB.insert(msgObject);
            io.emit('incomingMessage', msgObject);
        } catch (err) {
            console.error("Chat message write error.");
        }
    });
});

// 🚀 PRODUCTION DEPLOYMENT PORT BINDING (Render Injection Dynamic Handler)
const PORT = process.env.PORT || 3040;
server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` 🕌 PREMIUM AUTHENTICATED SERVER RUNNING ON PORT ${PORT}`);
    console.log(`====================================================`);
});