import { Layout } from '../components/Layout';
import { Shredded } from '../components/Shredded';

export default function NotFound() {
  return (
    <Layout title="Ephemera: page not found">
      <div className="center">
        <Shredded title="404: Page not found" stamp="Not found">
          <p className="lead-sm">There is nothing at this address. Check the link, or create a new secret.</p>
        </Shredded>
      </div>
    </Layout>
  );
}
