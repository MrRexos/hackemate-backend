const users = [
  {
    id: 'usr_1',
    name: 'Ada Lovelace',
    email: 'ada@hackemate.dev',
  },
];

export const getUsers = (_req, res) => {
  return res.status(200).json({
    data: users,
  });
};

export const createUser = (req, res, next) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      const error = new Error('Los campos name y email son obligatorios.');
      error.statusCode = 400;
      throw error;
    }

    const user = {
      id: `usr_${Date.now()}`,
      name,
      email,
    };

    users.push(user);

    return res.status(201).json({
      data: user,
    });
  } catch (error) {
    return next(error);
  }
};
