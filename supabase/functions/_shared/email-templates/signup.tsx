/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { styles } from './_brand.ts'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to start budgeting with Keeper</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Text style={styles.monogram}>K</Text>
          <Text style={styles.brandName}>KEEPER</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Confirm your email</Heading>
          <Text style={styles.text}>
            Welcome to Keeper. Please confirm{' '}
            <Link href={`mailto:${recipient}`} style={styles.link}>
              {recipient}
            </Link>{' '}
            to start budgeting together.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Confirm Email
            </Button>
          </Section>
          <div style={styles.divider} />
          <Text style={styles.fineprint}>
            This link expires in 24 hours. If you didn't create a Keeper
            account, you can safely ignore this email.
          </Text>
        </Section>
        <Section style={styles.footer}>
          <Text style={styles.footerText}>Keeper · Budgeting together.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
