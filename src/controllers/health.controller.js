export const getHealth = (_req, res) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Hackemate API funcionando',
  });
};
