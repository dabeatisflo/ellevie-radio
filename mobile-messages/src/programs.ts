export type Programme = {
  time: string;
  title: string;
  start: string;
  end: string;
};

export type ProgrammeGroup = {
  id: 'semaine' | 'samedi' | 'dimanche';
  shortLabel: string;
  title: string;
  programmes: Programme[];
};

const programme = (time: string, title: string): Programme => {
  const [start, end] = time.split(' - ');
  return { time, title, start, end };
};

export const PROGRAMME_GROUPS: ProgrammeGroup[] = [
  {
    id: 'semaine',
    shortLabel: 'Semaine',
    title: '📅 Du Lundi au Vendredi',
    programmes: [
      programme('06:00 - 09:00', 'Ellevie Matin'),
      programme('09:00 - 12:00', 'Vos Mélodies au Boulot'),
      programme('12:00 - 13:00', 'Le Lunch Pop-Classic'),
      programme('13:00 - 17:00', "L’Après-Midi Chic"),
      programme('17:00 - 19:00', 'Le Drive Énergie'),
      programme('19:00 - 22:00', 'Ellevie Lounge & Chill'),
      programme('22:00 - 07:00', 'La Nuit Douce'),
    ],
  },
  {
    id: 'samedi',
    shortLabel: 'Samedi',
    title: '🏖️ Le Samedi',
    programmes: [
      programme('07:00 - 10:00', 'La Douceur du Matin'),
      programme('10:00 - 14:00', 'Chic & Shopping'),
      programme('14:00 - 18:00', 'Génération Ellevie'),
      programme('18:00 - 21:00', "L’Apéro Ambiance"),
      programme('21:00 - 00:00', 'Ellevie Club Pop'),
      programme('00:00 - 07:00', 'La Nuit Douce'),
    ],
  },
  {
    id: 'dimanche',
    shortLabel: 'Dimanche',
    title: '🧸 Le Dimanche',
    programmes: [
      programme('07:00 - 11:00', 'Le Grand Petit-Déjeuner'),
      programme('11:00 - 14:00', 'Table En Famille'),
      programme('14:00 - 17:00', 'Balade & Détente'),
      programme('17:00 - 20:00', 'Nostalgie Douce'),
      programme('20:00 - 23:00', 'Sereine avant la Semaine'),
      programme('23:00 - 06:00', 'La Nuit Douce'),
    ],
  },
];

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

export const isProgrammeActive = (item: Programme, date = new Date()) => {
  const now = date.getHours() * 60 + date.getMinutes();
  const start = toMinutes(item.start);
  const end = toMinutes(item.end);

  if (start === end) return true;
  if (end < start) return now >= start || now < end;
  return now >= start && now < end;
};

export const getCurrentGroup = (date = new Date()) => {
  const day = date.getDay();
  if (day === 6) return PROGRAMME_GROUPS[1];
  if (day === 0) return PROGRAMME_GROUPS[2];
  return PROGRAMME_GROUPS[0];
};

export const getCurrentProgramme = (date = new Date()) => {
  const group = getCurrentGroup(date);
  return (
    group.programmes.find((item) => isProgrammeActive(item, date)) ?? {
      time: 'En direct',
      title: 'ellevie Radio',
      start: '00:00',
      end: '00:00',
    }
  );
};
