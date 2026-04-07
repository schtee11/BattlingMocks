import { pool } from './pool.js';

const PROSPECTS = [
  ['Arch Manning', 'QB', 'Texas'],
  ['Garrett Nussmeier', 'QB', 'LSU'],
  ['Drew Allar', 'QB', 'Penn State'],
  ['LaNorris Sellers', 'QB', 'South Carolina'],
  ['Cade Klubnik', 'QB', 'Clemson'],
  ['Sam Leavitt', 'QB', 'Arizona State'],
  ['DJ Lagway', 'QB', 'Florida'],
  ['Jeremiah Smith', 'WR', 'Ohio State'],
  ['Ryan Williams', 'WR', 'Alabama'],
  ['Carnell Tate', 'WR', 'Ohio State'],
  ['Antonio Williams', 'WR', 'Clemson'],
  ['Denzel Boston', 'WR', 'Washington'],
  ['Eric Singleton Jr.', 'WR', 'Auburn'],
  ['Makai Lemon', 'WR', 'USC'],
  ['Nyck Harbor', 'WR', 'South Carolina'],
  ['Cam Coleman', 'WR', 'Auburn'],
  ['Jordyn Tyson', 'WR', 'Arizona State'],
  ['Jeremiyah Love', 'RB', 'Notre Dame'],
  ['Nicholas Singleton', 'RB', 'Penn State'],
  ['Makhi Hughes', 'RB', 'Oregon'],
  ['Justice Haynes', 'RB', 'Michigan'],
  ['Caleb Lomu', 'OT', 'Utah'],
  ['Spencer Fano', 'OT', 'Utah'],
  ['Francis Mauigoa', 'OT', 'Miami'],
  ['Kadyn Proctor', 'OT', 'Alabama'],
  ['Isaiah World', 'OT', 'Oregon'],
  ['Austin Barber', 'OT', 'Florida'],
  ['Gennings Dunker', 'OT', 'Iowa'],
  ['Olaivavega Ioane', 'OG', 'Penn State'],
  ['Tyler Booker', 'OG', 'Alabama'],
  ['Jake Slaughter', 'OC', 'Florida'],
  ['Connor Lew', 'OC', 'Auburn'],
  ['T.J. Parker', 'EDGE', 'Clemson'],
  ['Rueben Bain Jr.', 'EDGE', 'Miami'],
  ['Keldric Faulk', 'EDGE', 'Auburn'],
  ['Dani Dennis-Sutton', 'EDGE', 'Penn State'],
  ['R Mason Thomas', 'EDGE', 'Oklahoma'],
  ['David Bailey', 'EDGE', 'Stanford'],
  ['Anthony Hill Jr.', 'LB', 'Texas'],
  ['Sonny Styles', 'LB', 'Ohio State'],
  ['Harold Perkins Jr.', 'LB', 'LSU'],
  ['Whit Weeks', 'LB', 'LSU'],
  ['Suntarine Perkins', 'LB', 'Ole Miss'],
  ['Peter Woods', 'DT', 'Clemson'],
  ['Caleb Banks', 'DT', 'Florida'],
  ['Christen Miller', 'DT', 'Georgia'],
  ['Tim Keenan III', 'DT', 'Alabama'],
  ['Deone Walker', 'DT', 'Kentucky'],
  ['Domonique Orange', 'DT', 'Iowa State'],
  ['Avieon Terrell', 'CB', 'Clemson'],
  ['Jermod McCoy', 'CB', 'Tennessee'],
  ['Mansoor Delane', 'CB', 'LSU'],
  ['Leonard Moore', 'CB', 'Notre Dame'],
  ['D''Angelo Ponds', 'CB', 'Indiana'],
  ['Malik Muhammad', 'CB', 'Texas'],
  ['Daylen Everette', 'CB', 'Georgia'],
  ['Caleb Downs', 'S', 'Ohio State'],
  ['Michael Taaffe', 'S', 'Texas'],
  ['Koi Perich', 'S', 'Minnesota'],
  ['KJ Bolden', 'S', 'Georgia'],
  ['Bray Hubbard', 'S', 'Alabama'],
  ['Dillon Thieneman', 'S', 'Oregon'],
  ['Andrew Mukuba', 'S', 'Texas'],
  ['Eli Stowers', 'TE', 'Vanderbilt'],
  ['Max Klare', 'TE', 'Purdue'],
  ['Luke Lachey', 'TE', 'Iowa'],
  ['Jake Briningstool', 'TE', 'Clemson'],
];

async function seed() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM players');
  if (rows[0].c > 0) {
    console.log('[seed] players already populated, skipping');
    return;
  }
  for (const [name, position, school] of PROSPECTS) {
    await pool.query(
      'INSERT INTO players (name, position, school) VALUES ($1, $2, $3)',
      [name, position, school]
    );
  }
  console.log(`[seed] inserted ${PROSPECTS.length} players`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export { seed };
